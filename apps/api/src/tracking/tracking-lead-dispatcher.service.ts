import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { RUNTIME_ENV, RUNTIME_FETCH, type RuntimeEnv, type RuntimeFetch } from "../common/runtime/runtime.module";
import { MetaConnectionResolverService } from "../integrations/meta/meta-connection-resolver.service";
import { trackingIngestEnabled } from "./tracking-ingest.service";

const INTERVAL_MS = 60_000;
const INITIAL_DELAY_MS = 15_000;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 6;
const CLICK_WAIT_MS = 15 * 60_000;
const META_EVENT_MAX_AGE_MS = 7 * 86_400_000;
const REQUEST_TIMEOUT_MS = 15_000;

type MatchRow = Prisma.TrackingContactMatchGetPayload<{ include: { trackingEvent: true } }>;
type ClickRow = NonNullable<MatchRow["trackingEvent"]>;

export type LeadDispatchOutcome =
  | { status: "sent"; responseSummary: Record<string, unknown> }
  | { status: "failed" | "skipped" | "disabled" | "expired" | "no_click"; error: string; responseSummary?: Record<string, unknown> }
  | { status: "retry"; error: string; responseSummary?: Record<string, unknown> };

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stringOf(record: unknown, key: string): string | undefined {
  const value = (record as Record<string, unknown> | null)?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** fbc from the cookie, or built from a real fbclid as Meta documents (fb.1.<click ms>.<fbclid>). */
export function fbcOf(click: Pick<ClickRow, "attribution" | "eventTime">): string | undefined {
  const cookie = stringOf(click.attribution, "fbc");
  if (cookie) return cookie;
  const fbclid = stringOf(click.attribution, "fbclid");
  return fbclid ? `fb.1.${click.eventTime.getTime()}.${fbclid}` : undefined;
}

export function buildWebsiteLeadPayload(
  match: Pick<MatchRow, "metaEventId" | "messageAt" | "phoneHashes" | "contactName">,
  click: Pick<
    ClickRow,
    "pageLocation" | "ipAddress" | "userAgent" | "attribution" | "eventTime" | "clientId" | "environment" | "modalidade" | "origem"
  >,
  testEventCode: string | null,
) {
  const firstName = match.contactName?.trim().split(/\s+/)[0]?.toLowerCase();
  const userData: Record<string, unknown> = {
    ph: match.phoneHashes,
    client_user_agent: click.userAgent,
    ...(click.ipAddress ? { client_ip_address: click.ipAddress } : {}),
    ...(stringOf(click.attribution, "fbp") ? { fbp: stringOf(click.attribution, "fbp") } : {}),
    ...(fbcOf(click) ? { fbc: fbcOf(click) } : {}),
    ...(click.clientId ? { external_id: [sha256(click.clientId)] } : {}),
    ...(firstName ? { fn: [sha256(firstName)] } : {}),
    country: [sha256("br")],
  };
  return {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(match.messageAt.getTime() / 1000),
        event_id: match.metaEventId,
        action_source: "website",
        ...(click.pageLocation ? { event_source_url: click.pageLocation } : {}),
        user_data: userData,
        custom_data: {
          lead_source: "whatsapp",
          environment: click.environment,
          ...(click.modalidade ? { modalidade: click.modalidade } : {}),
          ...(click.origem ? { origem: click.origem } : {}),
        },
      },
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
}

/**
 * Outbox worker: sends one website Lead per WhatsApp contact that carried a
 * click token. The event_id is fixed per token, so a resend after an
 * ambiguous timeout is deduplicated by Meta.
 */
@Injectable()
export class TrackingLeadDispatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TrackingLeadDispatcherService.name);
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RUNTIME_ENV) private readonly env: RuntimeEnv,
    @Inject(RUNTIME_FETCH) private readonly fetchFn: RuntimeFetch,
    @Inject(MetaConnectionResolverService) private readonly metaRoutes: MetaConnectionResolverService,
  ) {}

  onApplicationBootstrap(): void {
    if (!trackingIngestEnabled(this.env) || this.env.NODE_ENV === "test") return;
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.tick();
      this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    }, INITIAL_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
    this.initialTimer = null;
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.warn(JSON.stringify({ event: "tracking.lead_dispatch_failed", errorType: (error as Error)?.name }));
    } finally {
      this.running = false;
    }
  }

  async runOnce(now = new Date()): Promise<number> {
    const due = await this.prisma.trackingContactMatch.findMany({
      where: { metaStatus: { in: ["pending", "retrying"] }, nextAttemptAt: { lte: now } },
      include: { trackingEvent: true },
      orderBy: { nextAttemptAt: "asc" },
      take: BATCH_SIZE,
    });
    for (const match of due) {
      const outcome = await this.dispatch(match, now);
      await this.persist(match, outcome, now);
    }
    return due.length;
  }

  async dispatch(match: MatchRow, now: Date): Promise<LeadDispatchOutcome> {
    const connection = await this.prisma.trackingIngestConnection.findUnique({
      where: { workspaceId: match.workspaceId },
    });
    if (!connection?.metaLeadEnabled) return { status: "disabled", error: "Envio do Lead à Meta desligado" };
    if (now.getTime() - match.messageAt.getTime() > META_EVENT_MAX_AGE_MS) {
      return { status: "expired", error: "Mensagem com mais de 7 dias" };
    }

    let click = match.trackingEvent;
    if (!click) {
      click =
        (await this.prisma.trackingEvent.findFirst({
          where: { workspaceId: match.workspaceId, refToken: match.refToken, eventName: "click_whatsapp" },
          orderBy: { eventTime: "desc" },
        })) ??
        (await this.prisma.trackingEvent.findFirst({
          where: { workspaceId: match.workspaceId, refToken: match.refToken },
          orderBy: { eventTime: "desc" },
        }));
      if (click) {
        await this.prisma.trackingContactMatch.update({ where: { id: match.id }, data: { trackingEventId: click.id } });
      } else if (now.getTime() - match.createdAt.getTime() < CLICK_WAIT_MS) {
        return { status: "retry", error: "Clique do token ainda não recebido" };
      } else {
        return { status: "no_click", error: "Nenhum clique recebido com este token" };
      }
    }
    if (!click.userAgent) return { status: "skipped", error: "Clique sem user agent (exigido pela Meta em eventos de site)" };

    let route;
    try {
      route = await this.metaRoutes.resolveCapiRoute({ workspaceId: match.workspaceId });
    } catch (error) {
      return { status: "retry", error: `Rota Meta indisponível: ${(error as Error)?.message ?? "erro"}` };
    }
    const pixelId = connection.metaPixelId?.trim() || route.pixelId;
    if (!pixelId || !route.accessToken) return { status: "retry", error: "Pixel ou token da Meta não configurado" };

    const version = this.env.META_GRAPH_API_VERSION?.trim() || "v21.0";
    const url = new URL(`https://graph.facebook.com/${version}/${pixelId}/events`);
    url.searchParams.set("access_token", route.accessToken);
    const payload = buildWebsiteLeadPayload(match, click, connection.metaTestEventCode?.trim() || null);

    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return { status: "retry", error: `Falha de rede: ${(error as Error)?.name ?? "erro"}` };
    }
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const summary: Record<string, unknown> = {
      httpStatus: response.status,
      ...(body?.events_received !== undefined ? { events_received: body.events_received } : {}),
      ...(body?.fbtrace_id ? { fbtrace_id: body.fbtrace_id } : {}),
      ...(body?.error ? { error: body.error } : {}),
    };
    if (response.ok) return { status: "sent", responseSummary: summary };
    const message = stringOf(body?.error, "message") ?? `HTTP ${response.status}`;
    if (response.status === 429 || response.status >= 500) return { status: "retry", error: message, responseSummary: summary };
    return { status: "failed", error: message, responseSummary: summary };
  }

  private async persist(match: MatchRow, outcome: LeadDispatchOutcome, now: Date): Promise<void> {
    const attempts = match.attempts + 1;
    const exhausted = outcome.status === "retry" && attempts >= MAX_ATTEMPTS;
    const status = outcome.status === "retry" ? (exhausted ? "failed" : "retrying") : outcome.status;
    await this.prisma.trackingContactMatch.update({
      where: { id: match.id },
      data: {
        metaStatus: status,
        attempts,
        nextAttemptAt: new Date(now.getTime() + 60_000 * 2 ** Math.min(attempts, 8)),
        lastError: outcome.status === "sent" ? null : outcome.error.slice(0, 500),
        ...(outcome.responseSummary ? { responseSummary: outcome.responseSummary as Prisma.InputJsonValue } : {}),
        ...(outcome.status === "sent" ? { sentAt: now } : {}),
      },
    });
  }
}
