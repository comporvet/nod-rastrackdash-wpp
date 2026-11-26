import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { RUNTIME_ENV, type RuntimeEnv } from "../common/runtime/runtime.module";
import { ga4EnvironmentsSchema, type Ga4Environment } from "../google-analytics/ga4-environments";
import { matchesInboundWebhookSecret } from "../inbound-webhooks/inbound-webhook-ingestion.service";
import { trackingEventPayloadSchema, type TransportSource } from "./tracking-event.schema";
import { eventTimeOf, normalizeTrackingEvent, type NormalizedTrackingEvent } from "./tracking-normalize";

export const TRACKING_REQUEST_WINDOW_MS = 5 * 60_000;
export const TRACKING_EVENT_MAX_AGE_MS = 72 * 60 * 60_000;
const RATE_LIMIT_PER_MINUTE = 600;
const REJECTION_WRITE_INTERVAL_MS = 60_000;
const CONNECTION_ID_PATTERN = /^[a-z0-9]{10,40}$/;

export type TrackingRejectionReason =
  | "auth"
  | "schema"
  | "timestamp"
  | "event_not_allowed"
  | "rate_limited";

export type TrackingIngestInput = {
  connectionId: unknown;
  authorization: unknown;
  requestTimestamp: unknown;
  contentType: string | undefined;
  rawBody: Buffer | undefined;
  transportSource?: TransportSource;
};

export type TrackingIngestResult =
  | { status: "accepted"; eventId: string; duplicate: boolean }
  | { status: "ignored"; reason: "event_not_allowed" };

export function trackingIngestEnabled(env: RuntimeEnv): boolean {
  return env.TRACKING_INGEST_ENABLED?.trim().toLowerCase() === "true";
}

export function hashTrackingSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function bearerToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function recentHits(now: number, hits: number[]): number[] {
  return hits.filter((at) => at > now - 60_000);
}

@Injectable()
export class TrackingIngestService {
  private readonly logger = new Logger(TrackingIngestService.name);
  private readonly hitsByConnection = new Map<string, number[]>();
  private readonly lastRejectionWrite = new Map<string, number>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RUNTIME_ENV) private readonly env: RuntimeEnv,
  ) {}

  async ingest(input: TrackingIngestInput, now = Date.now()): Promise<TrackingIngestResult> {
    if (!trackingIngestEnabled(this.env)) throw this.notFound();

    const connection = await this.authenticate(input, now);
    this.enforceRateLimit(connection, now);

    const timestamp = Number(input.requestTimestamp);
    if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > TRACKING_REQUEST_WINDOW_MS) {
      await this.reject(connection.workspaceId, "timestamp", null, now);
      throw new UnauthorizedException("Requisição fora da janela de horário");
    }

    const mediaType = input.contentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      throw new UnsupportedMediaTypeException("Envie Content-Type application/json");
    }
    let body: unknown;
    try {
      body = JSON.parse(input.rawBody?.toString("utf8") ?? "");
    } catch {
      await this.reject(connection.workspaceId, "schema", null, now);
      throw new BadRequestException("Payload JSON inválido");
    }
    const parsed = trackingEventPayloadSchema.safeParse(body);
    if (!parsed.success) {
      await this.reject(connection.workspaceId, "schema", null, now);
      throw new BadRequestException("Evento fora do schema 1.0");
    }
    const eventTime = eventTimeOf(parsed.data.event_time).getTime();
    if (
      !Number.isFinite(eventTime) ||
      eventTime > now + TRACKING_REQUEST_WINDOW_MS ||
      eventTime < now - TRACKING_EVENT_MAX_AGE_MS
    ) {
      await this.reject(connection.workspaceId, "timestamp", parsed.data.event_name, now);
      throw new BadRequestException("Horário do evento fora do intervalo aceito");
    }
    if (!connection.allowedEvents.includes(parsed.data.event_name)) {
      await this.reject(connection.workspaceId, "event_not_allowed", parsed.data.event_name, now);
      return { status: "ignored", reason: "event_not_allowed" };
    }

    const environments = await this.environments(connection.workspaceId);
    const normalized = normalizeTrackingEvent(parsed.data, environments);
    const receiptKey = createHash("sha256").update(input.rawBody!).digest("hex");
    const stored = await this.store(
      connection.workspaceId,
      normalized,
      input.transportSource ?? "server",
      receiptKey,
      new Date(now),
    );
    await this.prisma.trackingIngestConnection.update({
      where: { id: connection.id },
      data: { lastReceivedAt: new Date(now) },
    });
    return { status: "accepted", eventId: stored.id, duplicate: stored.duplicate };
  }

  private async authenticate(input: TrackingIngestInput, now: number) {
    const connectionId = typeof input.connectionId === "string" ? input.connectionId.trim() : "";
    const connection = CONNECTION_ID_PATTERN.test(connectionId)
      ? await this.prisma.trackingIngestConnection.findUnique({ where: { id: connectionId } })
      : null;
    const tokenMatches = matchesInboundWebhookSecret(connection?.secretHash, bearerToken(input.authorization));
    if (!connection || !tokenMatches || connection.status !== "active") {
      await this.reject(connection?.workspaceId ?? null, "auth", null, now);
      throw this.notFound();
    }
    return connection;
  }

  private enforceRateLimit(connection: { id: string; workspaceId: string }, now: number): void {
    const hits = recentHits(now, this.hitsByConnection.get(connection.id) ?? []);
    if (hits.length >= RATE_LIMIT_PER_MINUTE) {
      this.hitsByConnection.set(connection.id, hits);
      void this.reject(connection.workspaceId, "rate_limited", null, now);
      throw new HttpException("Limite de eventos por minuto excedido", HttpStatus.TOO_MANY_REQUESTS);
    }
    hits.push(now);
    this.hitsByConnection.set(connection.id, hits);
  }

  private async environments(workspaceId: string): Promise<Ga4Environment[]> {
    const ga4 = await this.prisma.googleAnalyticsConnection.findUnique({
      where: { workspaceId },
      select: { environments: true },
    });
    const parsed = ga4EnvironmentsSchema.safeParse(ga4?.environments);
    return parsed.success ? parsed.data : [];
  }

  private async store(
    workspaceId: string,
    event: NormalizedTrackingEvent,
    transportSource: TransportSource,
    receiptKey: string,
    receivedAt: Date,
  ): Promise<{ id: string; duplicate: boolean }> {
    let existing = await this.prisma.trackingEvent.findUnique({
      where: { workspaceId_dedupeKey: { workspaceId, dedupeKey: event.dedupeKey } },
    });
    let duplicate = existing !== null;
    if (!existing) {
      try {
        existing = await this.prisma.trackingEvent.create({
          data: {
            workspaceId,
            ...event,
            firstReceivedAt: receivedAt,
            attribution: event.attribution as Prisma.InputJsonValue,
            consent: event.consent as Prisma.InputJsonValue,
            properties: event.properties as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        existing = await this.prisma.trackingEvent.findUniqueOrThrow({
          where: { workspaceId_dedupeKey: { workspaceId, dedupeKey: event.dedupeKey } },
        });
        duplicate = true;
      }
    } else {
      const fill = this.missingValues(existing, event);
      if (Object.keys(fill).length > 0) {
        await this.prisma.trackingEvent.update({ where: { id: existing.id }, data: fill });
      }
    }

    try {
      await this.prisma.trackingEventReceipt.create({
        data: {
          workspaceId,
          trackingEventId: existing.id,
          transportSource,
          receiptKey,
          receivedAt,
          latencyMs: Math.max(0, receivedAt.getTime() - event.eventTime.getTime()),
          duplicate,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      duplicate = true;
    }
    return { id: existing.id, duplicate };
  }

  /** A later copy may complete an earlier one; it never replaces a stored value. */
  private missingValues(
    stored: Record<string, unknown>,
    incoming: NormalizedTrackingEvent,
  ): Prisma.TrackingEventUpdateInput {
    const fill: Record<string, unknown> = {};
    for (const key of [
      "hostname",
      "pagePath",
      "pageLocation",
      "pageReferrerHost",
      "clientId",
      "sessionId",
      "modalidade",
      "origem",
    ] as const) {
      if (stored[key] == null && incoming[key] != null) fill[key] = incoming[key];
    }
    if (stored.environment === "unknown" && incoming.environment !== "unknown") {
      fill.environment = incoming.environment;
    }
    for (const key of ["attribution", "consent", "properties"] as const) {
      const current = (stored[key] ?? {}) as Record<string, unknown>;
      const additions = Object.fromEntries(
        Object.entries(incoming[key]).filter(([name]) => current[name] == null),
      );
      if (Object.keys(additions).length > 0) fill[key] = { ...current, ...additions };
    }
    return fill as Prisma.TrackingEventUpdateInput;
  }

  private async reject(
    workspaceId: string | null,
    reason: TrackingRejectionReason,
    eventName: string | null,
    now: number,
  ): Promise<void> {
    const key = `${workspaceId ?? "-"}:${reason}`;
    const last = this.lastRejectionWrite.get(key);
    if (last !== undefined && now - last < REJECTION_WRITE_INTERVAL_MS) return;
    this.lastRejectionWrite.set(key, now);
    try {
      await this.prisma.trackingIngestRejection.create({ data: { workspaceId, reason, eventName } });
    } catch (error) {
      this.logger.warn(
        JSON.stringify({ event: "tracking.rejection_write_failed", reason, errorType: (error as Error)?.name }),
      );
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException("Recepção de eventos não encontrada");
  }
}
