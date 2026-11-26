import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../src/common/prisma/prisma.service";
import { RUNTIME_ENV } from "../../src/common/runtime/runtime.module";
import { comporvetEnvironmentPreset } from "../../src/google-analytics/ga4-environments";
import { configureInboundWebhookBodyParser } from "../../src/inbound-webhooks/inbound-webhook-body-parser";
import { TrackingIngestController } from "../../src/tracking/tracking-ingest.controller";
import { TrackingIngestService, hashTrackingSecret } from "../../src/tracking/tracking-ingest.service";
import { normalizeTrackingEvent, sanitizePageLocation } from "../../src/tracking/tracking-normalize";
import { monitorRange, summarizeEvents } from "../../src/tracking/tracking.service";

const CONNECTION_ID = "cmtrackingconnection01";
const TOKEN = "synthetic-ingest-token";
const NOW = Date.parse("2026-11-26T18:00:00Z");

function uniqueViolation(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakePrisma(options: { status?: string; environments?: unknown } = {}) {
  const connection = {
    id: CONNECTION_ID,
    workspaceId: "ws_1",
    secretHash: hashTrackingSecret(TOKEN),
    allowedEvents: ["page_view", "scroll_depth", "click_whatsapp", "click"],
    status: options.status ?? "active",
    lastReceivedAt: null as Date | null,
  };
  const events: any[] = [];
  const receipts: any[] = [];
  const rejections: any[] = [];
  const byKey = (where: any) =>
    events.find(
      (event) =>
        event.workspaceId === where.workspaceId_dedupeKey.workspaceId &&
        event.dedupeKey === where.workspaceId_dedupeKey.dedupeKey,
    ) ?? null;
  return {
    events,
    receipts,
    rejections,
    connection,
    trackingIngestConnection: {
      findUnique: vi.fn(async ({ where }: any) => (where.id === connection.id ? connection : null)),
      update: vi.fn(async ({ data }: any) => Object.assign(connection, data)),
    },
    googleAnalyticsConnection: {
      findUnique: vi.fn(async () =>
        options.environments === null ? null : { environments: options.environments ?? comporvetEnvironmentPreset },
      ),
    },
    trackingEvent: {
      findUnique: vi.fn(async ({ where }: any) => {
        await tick();
        return byKey(where);
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => byKey(where)),
      create: vi.fn(async ({ data }: any) => {
        await tick();
        if (events.some((event) => event.workspaceId === data.workspaceId && event.dedupeKey === data.dedupeKey)) {
          throw uniqueViolation();
        }
        const row = { id: `evt_${events.length + 1}`, ...data };
        events.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = events.find((event) => event.id === where.id);
        return Object.assign(row, data);
      }),
    },
    trackingEventReceipt: {
      create: vi.fn(async ({ data }: any) => {
        if (
          receipts.some(
            (receipt) =>
              receipt.trackingEventId === data.trackingEventId &&
              receipt.transportSource === data.transportSource &&
              receipt.receiptKey === data.receiptKey,
          )
        ) {
          throw uniqueViolation();
        }
        receipts.push(data);
        return data;
      }),
    },
    trackingIngestRejection: {
      create: vi.fn(async ({ data }: any) => {
        rejections.push(data);
        return data;
      }),
    },
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "1.0",
    event_name: "click_whatsapp",
    event_id: "cv-123",
    event_time: NOW - 2_000,
    page_location: "https://consultas.comporvet.com.br/?utm_source=google&gclid=abc&email=cliente%40exemplo.com",
    client_id: "123.456",
    session_id: "1732640000",
    modalidade: "online",
    ...overrides,
  };
}

const enabledEnv = { TRACKING_INGEST_ENABLED: "true", API_PUBLIC_URL: "https://api.example.com" };

function service(prisma = fakePrisma(), env: Record<string, string> = enabledEnv) {
  return { prisma, ingest: new TrackingIngestService(prisma as any, env) };
}

function input(body: unknown, overrides: Record<string, unknown> = {}) {
  return {
    connectionId: CONNECTION_ID,
    authorization: `Bearer ${TOKEN}`,
    requestTimestamp: String(NOW),
    contentType: "application/json",
    rawBody: Buffer.from(JSON.stringify(body)),
    ...overrides,
  };
}

describe("autenticação da recepção", () => {
  it.each([
    ["sem token", { authorization: undefined }],
    ["token errado", { authorization: "Bearer outro" }],
    ["conexão desconhecida", { connectionId: "cmdesconhecida000001" }],
    ["id malformado", { connectionId: "../x" }],
  ])("%s responde 404", async (_label, overrides) => {
    const { ingest, prisma } = service();
    await expect(ingest.ingest(input(event(), overrides), NOW)).rejects.toMatchObject({ status: 404 });
    expect(prisma.events).toHaveLength(0);
  });

  it("conexão pausada e flag desligada respondem o mesmo 404", async () => {
    await expect(service(fakePrisma({ status: "paused" })).ingest.ingest(input(event()), NOW)).rejects.toMatchObject({
      status: 404,
    });
    await expect(service(fakePrisma(), {}).ingest.ingest(input(event()), NOW)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("recusa timestamp da requisição fora da janela de 5 minutos", async () => {
    const { ingest, prisma } = service();
    await expect(
      ingest.ingest(input(event(), { requestTimestamp: String(NOW - 6 * 60_000) }), NOW),
    ).rejects.toMatchObject({ status: 401 });
    expect(prisma.rejections[0]).toMatchObject({ reason: "timestamp" });
  });
});

describe("validação do payload", () => {
  it("recusa schema inválido com 400 e registra o motivo", async () => {
    const { ingest, prisma } = service();
    await expect(ingest.ingest(input({ ...event(), schema_version: "2.0" }), NOW)).rejects.toMatchObject({
      status: 400,
    });
    await expect(ingest.ingest(input(event(), { rawBody: Buffer.from("{") }), NOW)).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma.rejections.map((row) => row.reason)).toEqual(["schema"]);
  });

  it("recusa evento antigo demais", async () => {
    const { ingest } = service();
    await expect(
      ingest.ingest(input(event({ event_time: NOW - 4 * 86_400_000 })), NOW),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("ignora evento fora da lista permitida sem gravar", async () => {
    const { ingest, prisma } = service();
    await expect(ingest.ingest(input(event({ event_name: "user_engagement" })), NOW)).resolves.toEqual({
      status: "ignored",
      reason: "event_not_allowed",
    });
    expect(prisma.events).toHaveLength(0);
    expect(prisma.rejections[0]).toMatchObject({ reason: "event_not_allowed", eventName: "user_engagement" });
  });
});

describe("deduplicação", () => {
  it("o mesmo POST repetido é um evento e um recibo", async () => {
    const { ingest, prisma } = service();
    const first = await ingest.ingest(input(event()), NOW);
    const second = await ingest.ingest(input(event()), NOW);
    expect(first).toMatchObject({ status: "accepted", duplicate: false });
    expect(second).toMatchObject({ status: "accepted", duplicate: true });
    expect(prisma.events).toHaveLength(1);
    expect(prisma.receipts).toHaveLength(1);
  });

  it("outra cópia do mesmo event_id gera um recibo duplicado", async () => {
    const { ingest, prisma } = service();
    await ingest.ingest(input(event()), NOW);
    await ingest.ingest(input(event({ session_id: undefined, event_time: NOW - 1_000 })), NOW);
    expect(prisma.events).toHaveLength(1);
    expect(prisma.receipts.map((receipt) => receipt.duplicate)).toEqual([false, true]);
  });

  it("event_ids diferentes e nomes diferentes não são unidos", async () => {
    const { ingest, prisma } = service();
    await ingest.ingest(input(event()), NOW);
    await ingest.ingest(input(event({ event_id: "cv-124" })), NOW);
    await ingest.ingest(input(event({ event_name: "click" })), NOW);
    expect(prisma.events).toHaveLength(3);
  });

  it("requisições concorrentes com a mesma chave criam um único evento", async () => {
    const { ingest, prisma } = service();
    const results = await Promise.all([
      ingest.ingest(input(event()), NOW),
      ingest.ingest(input(event({ client_id: "123.456", origem: "teste" })), NOW),
    ]);
    expect(prisma.events).toHaveLength(1);
    expect(results.filter((result) => result.status === "accepted" && result.duplicate)).toHaveLength(1);
  });

  it("uma cópia posterior completa campos nulos e não sobrescreve valores", async () => {
    const { ingest, prisma } = service();
    await ingest.ingest(input(event({ session_id: undefined, modalidade: undefined })), NOW);
    await ingest.ingest(
      input(event({ modalidade: "presencial", client_id: "999.999", page_location: undefined })),
      NOW,
    );
    expect(prisma.events[0]).toMatchObject({
      sessionId: "1732640000",
      modalidade: "presencial",
      clientId: "123.456",
      pageLocation: "https://consultas.comporvet.com.br/?utm_source=google&gclid=abc",
    });
  });

  it("sem event_id usa chave derivada estável e marcada", () => {
    const payload = event({ event_id: undefined }) as any;
    const a = normalizeTrackingEvent(payload, comporvetEnvironmentPreset);
    const b = normalizeTrackingEvent(payload, comporvetEnvironmentPreset);
    const c = normalizeTrackingEvent({ ...payload, event_time: NOW - 1_999 }, comporvetEnvironmentPreset);
    expect(a.dedupeConfidence).toBe("derived");
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(a.dedupeKey).not.toBe(c.dedupeKey);
  });
});

describe("normalização", () => {
  it.each([
    ["https://comporvet.com.br/", "site"],
    ["https://www.comporvet.com.br/sobre", "site"],
    ["https://consultas.comporvet.com.br/", "lp_online"],
    ["https://consultas.comporvet.com.br/online/?utm_source=meta", "lp_online"],
    ["https://consultas.comporvet.com.br/presencial/", "lp_presencial"],
    ["https://comporvet.com.br.golpe.example/", "unknown"],
  ])("%s -> %s", (location, expected) => {
    expect(normalizeTrackingEvent(event({ page_location: location }) as any, comporvetEnvironmentPreset).environment).toBe(
      expected,
    );
  });

  it("sem regras de ambiente classifica como unknown", () => {
    expect(normalizeTrackingEvent(event() as any, []).environment).toBe("unknown");
  });

  it("mantém UTMs e gclid e descarta outros parâmetros da URL", () => {
    const normalized = normalizeTrackingEvent(event() as any, comporvetEnvironmentPreset);
    expect(normalized.pageLocation).toBe("https://consultas.comporvet.com.br/?utm_source=google&gclid=abc");
    expect(normalized.attribution).toEqual({ utm_source: "google", gclid: "abc" });
    expect(sanitizePageLocation(new URL("https://x.com/a?tel=48999999999&fbclid=f"))).toBe("https://x.com/a?fbclid=f");
  });

  it("aceita só identificadores e propriedades permitidos", () => {
    const normalized = normalizeTrackingEvent(
      event({
        attribution: { fbp: "fb.1.1.1", fbc: "", telefone: "48999999999" },
        properties: {
          percent_scrolled: "75",
          link_url: "https://wa.me/5548999106081?text=Ol%C3%A1",
          nome: "Fulano",
        },
      }) as any,
      comporvetEnvironmentPreset,
    );
    expect(normalized.attribution).toEqual({ utm_source: "google", gclid: "abc", fbp: "fb.1.1.1" });
    expect(normalized.properties).toEqual({ percent_scrolled: 75, link_url: "https://wa.me/5548999106081" });
  });
});

describe("monitor", () => {
  it("resume eventos por ambiente e a cobertura dos identificadores", () => {
    const summary = summarizeEvents([
      { id: "1", eventName: "page_view", environment: "site", eventId: "a", sessionId: "s", dedupeConfidence: "event_id", eventTime: new Date(), attribution: { utm_source: "google", gclid: "g" } },
      { id: "2", eventName: "page_view", environment: "site", eventId: null, sessionId: null, dedupeConfidence: "derived", eventTime: new Date(), attribution: { fbp: "f" } },
    ]);
    expect(summary.byEnvironmentAndEvent).toEqual([{ environment: "site", eventName: "page_view", count: 2 }]);
    expect(summary.quality).toEqual({
      eventIdCoverage: 0.5,
      sessionCoverage: 0.5,
      utmCoverage: 0.5,
      googleIdCoverage: 0.5,
      metaIdCoverage: 0.5,
    });
  });

  it("usa dias de São Paulo e limita o período", () => {
    const range = monitorRange("2026-11-20", "2026-11-26");
    expect(range.from.toISOString()).toBe("2026-11-20T03:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-11-27T03:00:00.000Z");
    expect(() => monitorRange("2026-01-01", "2026-11-26")).toThrow();
  });
});

describe("rota HTTP", () => {
  const apps: NestExpressApplication[] = [];
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
  });

  async function appFor(prisma = fakePrisma()) {
    const module = await Test.createTestingModule({
      controllers: [TrackingIngestController],
      providers: [
        TrackingIngestService,
        { provide: PrismaService, useValue: prisma },
        { provide: RUNTIME_ENV, useValue: enabledEnv },
      ],
    }).compile();
    const app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureInboundWebhookBodyParser(app);
    apps.push(app);
    await app.init();
    return { prisma, api: request(app.getHttpServer()) };
  }

  it("aceita com 202 e recusa payload acima de 32 KB", async () => {
    const { api, prisma } = await appFor();
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      "x-rastrack-connection": CONNECTION_ID,
      "x-rastrack-timestamp": String(Date.now()),
    };
    const ok = await api
      .post("/tracking/server/v1/events")
      .set(headers)
      .send(JSON.stringify(event({ event_time: Date.now() })));
    expect(ok.status).toBe(202);
    expect(ok.body).toMatchObject({ status: "accepted", duplicate: false });
    expect(prisma.events).toHaveLength(1);

    const big = await api
      .post("/tracking/server/v1/events")
      .set(headers)
      .send(JSON.stringify(event({ page_referrer: "x".repeat(40_000) })));
    expect(big.status).toBe(413);
  });
});
