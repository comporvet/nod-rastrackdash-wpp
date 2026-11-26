import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../common/prisma/prisma.service";
import { RUNTIME_ENV, type RuntimeEnv } from "../common/runtime/runtime.module";
import { DEFAULT_ALLOWED_EVENTS, connectionUpdateSchema } from "./tracking-event.schema";
import { hashTrackingSecret, trackingIngestEnabled } from "./tracking-ingest.service";

export const TRACKING_INGEST_PATH = "/tracking/server/v1/events";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 93;
const MAX_EVENTS_SCANNED = 50_000;
const SAO_PAULO_OFFSET = "-03:00";
const GOOGLE_IDS = ["gclid", "gbraid", "wbraid", "dclid"];
const META_IDS = ["fbclid", "fbp", "fbc", "ctwa_clid"];

type MonitorEventRow = {
  id: string;
  eventName: string;
  environment: string;
  eventId: string | null;
  sessionId: string | null;
  dedupeConfidence: string;
  eventTime: Date;
  attribution: unknown;
};

function saoPauloDate(date: Date): string {
  return new Date(date.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

export function monitorRange(since?: string, until?: string, now = new Date()) {
  const end = until ?? saoPauloDate(now);
  const start = since ?? saoPauloDate(new Date(Date.parse(`${end}T12:00:00${SAO_PAULO_OFFSET}`) - 6 * 86_400_000));
  if (!DATE_PATTERN.test(start) || !DATE_PATTERN.test(end)) {
    throw new BadRequestException("Período inválido");
  }
  const from = new Date(`${start}T00:00:00${SAO_PAULO_OFFSET}`);
  const to = new Date(Date.parse(`${end}T00:00:00${SAO_PAULO_OFFSET}`) + 86_400_000);
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days < 1 || days > MAX_RANGE_DAYS) {
    throw new BadRequestException(`Escolha um período de 1 a ${MAX_RANGE_DAYS} dias`);
  }
  return { since: start, until: end, from, to };
}

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!;
}

function ratio(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

export function summarizeEvents(events: MonitorEventRow[]) {
  const matrix = new Map<string, number>();
  let withoutEventId = 0;
  let withoutSession = 0;
  let withUtm = 0;
  let withGoogle = 0;
  let withMeta = 0;
  for (const event of events) {
    const key = `${event.environment}|${event.eventName}`;
    matrix.set(key, (matrix.get(key) ?? 0) + 1);
    if (!event.eventId) withoutEventId += 1;
    if (!event.sessionId) withoutSession += 1;
    const attribution = (event.attribution ?? {}) as Record<string, unknown>;
    if (Object.keys(attribution).some((name) => name.startsWith("utm_"))) withUtm += 1;
    if (GOOGLE_IDS.some((name) => attribution[name])) withGoogle += 1;
    if (META_IDS.some((name) => attribution[name])) withMeta += 1;
  }
  const total = events.length;
  return {
    uniqueEvents: total,
    byEnvironmentAndEvent: [...matrix.entries()]
      .map(([key, count]) => {
        const [environment, eventName] = key.split("|") as [string, string];
        return { environment, eventName, count };
      })
      .sort((a, b) => a.environment.localeCompare(b.environment) || b.count - a.count),
    quality: {
      eventIdCoverage: ratio(total - withoutEventId, total),
      sessionCoverage: ratio(total - withoutSession, total),
      utmCoverage: ratio(withUtm, total),
      googleIdCoverage: ratio(withGoogle, total),
      metaIdCoverage: ratio(withMeta, total),
    },
  };
}

@Injectable()
export class TrackingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RUNTIME_ENV) private readonly env: RuntimeEnv,
  ) {}

  async getConnection(workspaceId: string) {
    const connection = await this.prisma.trackingIngestConnection.findUnique({ where: { workspaceId } });
    return {
      enabled: trackingIngestEnabled(this.env),
      endpointUrl: this.endpointUrl(),
      connection: connection
        ? {
            id: connection.id,
            status: connection.status,
            allowedEvents: connection.allowedEvents,
            metaLeadEnabled: connection.metaLeadEnabled,
            metaPixelId: connection.metaPixelId,
            metaTestEventCode: connection.metaTestEventCode,
            lastReceivedAt: connection.lastReceivedAt?.toISOString() ?? null,
            createdAt: connection.createdAt.toISOString(),
          }
        : null,
    };
  }

  async updateConnection(workspaceId: string, input: unknown) {
    const parsed = connectionUpdateSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException("Configuração inválida");
    const existing = await this.prisma.trackingIngestConnection.findUnique({ where: { workspaceId } });
    if (!existing) throw new NotFoundException("Gere o token da recepção primeiro");
    await this.prisma.trackingIngestConnection.update({
      where: { workspaceId },
      data: {
        ...(parsed.data.allowedEvents ? { allowedEvents: [...new Set(parsed.data.allowedEvents)] } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.metaLeadEnabled !== undefined ? { metaLeadEnabled: parsed.data.metaLeadEnabled } : {}),
        ...(parsed.data.metaPixelId !== undefined ? { metaPixelId: parsed.data.metaPixelId || null } : {}),
        ...(parsed.data.metaTestEventCode !== undefined
          ? { metaTestEventCode: parsed.data.metaTestEventCode || null }
          : {}),
      },
    });
    return this.getConnection(workspaceId);
  }

  /** The token is returned only here; the database keeps its SHA-256. */
  async rotateToken(workspaceId: string) {
    const token = randomBytes(32).toString("base64url");
    const secretHash = hashTrackingSecret(token);
    const connection = await this.prisma.trackingIngestConnection.upsert({
      where: { workspaceId },
      create: { workspaceId, secretHash, allowedEvents: DEFAULT_ALLOWED_EVENTS },
      update: { secretHash },
    });
    return { connectionId: connection.id, token, endpointUrl: this.endpointUrl() };
  }

  async monitor(workspaceId: string, query: { since?: string; until?: string }) {
    const range = monitorRange(query.since, query.until);
    const [connection, events, receipts, rejections, recent, contacts, recentContacts] = await Promise.all([
      this.prisma.trackingIngestConnection.findUnique({ where: { workspaceId } }),
      this.prisma.trackingEvent.findMany({
        where: { workspaceId, eventTime: { gte: range.from, lt: range.to } },
        select: {
          id: true,
          eventName: true,
          environment: true,
          eventId: true,
          sessionId: true,
          dedupeConfidence: true,
          eventTime: true,
          attribution: true,
        },
        take: MAX_EVENTS_SCANNED,
      }),
      this.prisma.trackingEventReceipt.findMany({
        where: { workspaceId, receivedAt: { gte: range.from, lt: range.to } },
        select: { duplicate: true, latencyMs: true },
        take: MAX_EVENTS_SCANNED,
      }),
      this.prisma.trackingIngestRejection.groupBy({
        by: ["reason"],
        where: { workspaceId, createdAt: { gte: range.from, lt: range.to } },
        _count: { _all: true },
      }),
      this.prisma.trackingEvent.findMany({
        where: { workspaceId },
        orderBy: { firstReceivedAt: "desc" },
        take: 20,
        select: {
          eventName: true,
          environment: true,
          eventTime: true,
          firstReceivedAt: true,
          dedupeConfidence: true,
          pagePath: true,
          _count: { select: { receipts: true } },
        },
      }),
      this.prisma.trackingContactMatch.groupBy({
        by: ["metaStatus"],
        where: { workspaceId, messageAt: { gte: range.from, lt: range.to } },
        _count: { _all: true },
      }),
      this.prisma.trackingContactMatch.findMany({
        where: { workspaceId },
        orderBy: { messageAt: "desc" },
        take: 20,
        select: {
          refToken: true,
          messageAt: true,
          metaStatus: true,
          attempts: true,
          lastError: true,
          sentAt: true,
          trackingEvent: { select: { environment: true, pagePath: true, eventTime: true } },
        },
      }),
    ]);
    const latencies = receipts
      .map((receipt) => receipt.latencyMs)
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => a - b);
    return {
      since: range.since,
      until: range.until,
      enabled: trackingIngestEnabled(this.env),
      configured: connection !== null,
      status: connection?.status ?? null,
      lastReceivedAt: connection?.lastReceivedAt?.toISOString() ?? null,
      truncated: events.length >= MAX_EVENTS_SCANNED,
      receipts: receipts.length,
      duplicateReceipts: receipts.filter((receipt) => receipt.duplicate).length,
      latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
      rejections: rejections
        .map((row) => ({ reason: row.reason, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      ...summarizeEvents(events),
      contacts: contacts
        .map((row) => ({ status: row.metaStatus, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      recentContacts: recentContacts.map((row) => ({
        refToken: row.refToken,
        messageAt: row.messageAt.toISOString(),
        status: row.metaStatus,
        attempts: row.attempts,
        lastError: row.lastError,
        sentAt: row.sentAt?.toISOString() ?? null,
        environment: row.trackingEvent?.environment ?? null,
        pagePath: row.trackingEvent?.pagePath ?? null,
        clickTime: row.trackingEvent?.eventTime.toISOString() ?? null,
      })),
      derivedKeys: events.filter((event) => event.dedupeConfidence === "derived").length,
      recent: recent.map((event) => ({
        eventName: event.eventName,
        environment: event.environment,
        pagePath: event.pagePath,
        eventTime: event.eventTime.toISOString(),
        receivedAt: event.firstReceivedAt.toISOString(),
        dedupeConfidence: event.dedupeConfidence,
        receipts: event._count.receipts,
      })),
    };
  }

  private endpointUrl(): string | null {
    const base = this.env.API_PUBLIC_URL?.trim().replace(/\/+$/, "");
    return base ? `${base}${TRACKING_INGEST_PATH}` : null;
  }
}
