import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { comporvetEnvironmentPreset } from "../../src/google-analytics/ga4-environments";
import {
  TrackingContactMatcherService,
  extractRefToken,
  leadMetaEventId,
  metaPhoneHashes,
} from "../../src/tracking/tracking-contact-matcher.service";
import { trackingEventPayloadSchema } from "../../src/tracking/tracking-event.schema";
import {
  TrackingLeadDispatcherService,
  buildWebsiteLeadPayload,
  fbcOf,
} from "../../src/tracking/tracking-lead-dispatcher.service";
import { normalizeTrackingEvent } from "../../src/tracking/tracking-normalize";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const NOW = new Date("2026-11-26T18:00:00Z");

function inboundEvent(overrides: Record<string, any> = {}) {
  return {
    provider: "meta_cloud",
    externalMessageId: "wamid.1",
    occurredAt: new Date("2026-11-26T17:59:00Z"),
    channel: { providerChannelId: "pn_1", connectedPhone: "5548999106081", name: null },
    contact: { externalContactId: "5548991234567", phoneNumber: "5548991234567", name: "Maria Souza" },
    message: {
      direction: "inbound",
      authorType: "contact",
      messageType: "text",
      text: "Olá! Gostaria de informações.\n\n_Atendimento: CV-A7K9M2_",
      isPrivate: false,
    },
    ...overrides,
  } as any;
}

function click(overrides: Record<string, any> = {}) {
  return {
    id: "evt_click",
    workspaceId: "ws_1",
    eventName: "click_whatsapp",
    refToken: "CV-A7K9M2",
    eventTime: new Date("2026-11-26T17:58:00Z"),
    pageLocation: "https://consultas.comporvet.com.br/?utm_source=meta&fbclid=IwAR123",
    ipAddress: "200.150.10.20",
    userAgent: "Mozilla/5.0 (iPhone)",
    attribution: { fbp: "fb.1.1732640000000.123456", fbclid: "IwAR123" },
    clientId: "123.456",
    environment: "lp_online",
    modalidade: "online",
    origem: null,
    ...overrides,
  };
}

describe("token de referência", () => {
  it("extrai o token do texto, sem diferenciar maiúsculas", () => {
    expect(extractRefToken("Olá\n\n_Atendimento: CV-A7K9M2_")).toBe("CV-A7K9M2");
    expect(extractRefToken("Olá\n\nRef.: CV-A7K9M2")).toBe("CV-A7K9M2");
    expect(extractRefToken("XCV-A7K9M2")).toBeNull();
    expect(extractRefToken("CV-A7K9M2B")).toBeNull();
    expect(extractRefToken("ref: cv-a7k9m2 obrigado")).toBe("CV-A7K9M2");
    expect(extractRefToken("CV-A7K9M")).toBeNull();
    expect(extractRefToken("CV-A7K9M0")).toBeNull();
    expect(extractRefToken(null)).toBeNull();
  });

  it("aceita o token no payload do sGTM e grava IP e user agent", () => {
    const parsed = trackingEventPayloadSchema.parse({
      schema_version: "1.0",
      event_name: "click_whatsapp",
      event_time: NOW.getTime(),
      ref_token: "cv-a7k9m2",
      ip_address: "200.150.10.20",
      user_agent: "Mozilla/5.0",
    });
    const normalized = normalizeTrackingEvent(parsed, comporvetEnvironmentPreset);
    expect(normalized).toMatchObject({ refToken: "CV-A7K9M2", ipAddress: "200.150.10.20", userAgent: "Mozilla/5.0" });
    expect(
      trackingEventPayloadSchema.safeParse({
        schema_version: "1.0",
        event_name: "click",
        event_time: NOW.getTime(),
        ref_token: "CV-123",
      }).success,
    ).toBe(false);
  });

  it("gera o hash do telefone nas duas formas do nono dígito", () => {
    expect(metaPhoneHashes("+55 (48) 99123-4567")).toEqual([sha("5548991234567"), sha("554891234567")]);
    expect(metaPhoneHashes("abc")).toEqual([]);
  });

  it("usa um event_id fixo por token", () => {
    expect(leadMetaEventId("ws_1", "CV-A7K9M2")).toBe(leadMetaEventId("ws_1", "CV-A7K9M2"));
    expect(leadMetaEventId("ws_1", "CV-A7K9M2")).not.toBe(leadMetaEventId("ws_1", "CV-A7K9M3"));
  });
});

function matcherPrisma(clicks: any[] = [click()]) {
  const matches: any[] = [];
  return {
    matches,
    trackingEvent: {
      findFirst: vi.fn(async ({ where }: any) =>
        clicks
          .filter((row) => row.refToken === where.refToken && (!where.eventName || row.eventName === where.eventName))
          .sort((a, b) => b.eventTime - a.eventTime)[0] ?? null,
      ),
    },
    trackingContactMatch: {
      create: vi.fn(async ({ data }: any) => {
        if (
          matches.some(
            (row) =>
              row.workspaceId === data.workspaceId &&
              (row.refToken === data.refToken || row.externalMessageId === data.externalMessageId),
          )
        ) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        matches.push(data);
        return data;
      }),
    },
  };
}

describe("ligação da mensagem do WhatsApp oficial ao clique", () => {
  it("liga o telefone ao click_whatsapp do mesmo token", async () => {
    const prisma = matcherPrisma([click({ id: "evt_page", eventName: "page_view" }), click()]);
    const matcher = new TrackingContactMatcherService(prisma as any);
    await expect(matcher.recordInboundMessages("ws_1", [inboundEvent()])).resolves.toBe(1);
    expect(prisma.matches[0]).toMatchObject({
      refToken: "CV-A7K9M2",
      trackingEventId: "evt_click",
      externalMessageId: "wamid.1",
      phoneHashes: [sha("5548991234567"), sha("554891234567")],
      contactName: "Maria Souza",
      metaEventId: leadMetaEventId("ws_1", "CV-A7K9M2"),
    });
  });

  it("guarda o contato mesmo antes do clique chegar", async () => {
    const prisma = matcherPrisma([]);
    await new TrackingContactMatcherService(prisma as any).recordInboundMessages("ws_1", [inboundEvent()]);
    expect(prisma.matches[0]).toMatchObject({ trackingEventId: null });
  });

  it("ignora mensagem repetida, segundo uso do token, saída e texto sem token", async () => {
    const prisma = matcherPrisma();
    const matcher = new TrackingContactMatcherService(prisma as any);
    const recorded = await matcher.recordInboundMessages("ws_1", [
      inboundEvent(),
      inboundEvent(),
      inboundEvent({ externalMessageId: "wamid.2" }),
      inboundEvent({ externalMessageId: "wamid.3", message: { ...inboundEvent().message, direction: "outbound" } }),
      inboundEvent({ externalMessageId: "wamid.4", message: { ...inboundEvent().message, text: "Oi" } }),
    ]);
    expect(recorded).toBe(1);
    expect(prisma.matches).toHaveLength(1);
  });
});

describe("payload do Lead de site", () => {
  const match = {
    metaEventId: "rtd_lead_abc",
    messageAt: new Date("2026-11-26T17:59:00Z"),
    phoneHashes: [sha("5548991234567")],
    contactName: "Maria Souza",
  };

  it("monta o evento website com telefone, fbp, fbc, IP e user agent", () => {
    const payload = buildWebsiteLeadPayload(match, click() as any, "TEST123");
    expect(payload).toEqual({
      data: [
        {
          event_name: "Lead",
          event_time: Math.floor(match.messageAt.getTime() / 1000),
          event_id: "rtd_lead_abc",
          action_source: "website",
          event_source_url: "https://consultas.comporvet.com.br/?utm_source=meta&fbclid=IwAR123",
          user_data: {
            ph: [sha("5548991234567")],
            client_user_agent: "Mozilla/5.0 (iPhone)",
            client_ip_address: "200.150.10.20",
            fbp: "fb.1.1732640000000.123456",
            fbc: `fb.1.${click().eventTime.getTime()}.IwAR123`,
            external_id: [sha("123.456")],
            fn: [sha("maria")],
            country: [sha("br")],
          },
          custom_data: { lead_source: "whatsapp", environment: "lp_online", modalidade: "online" },
        },
      ],
      test_event_code: "TEST123",
    });
  });

  it("prefere o cookie _fbc e não inventa fbc sem fbclid", () => {
    expect(fbcOf({ attribution: { fbc: "fb.1.1.cookie", fbclid: "x" }, eventTime: NOW } as any)).toBe("fb.1.1.cookie");
    expect(fbcOf({ attribution: {}, eventTime: NOW } as any)).toBeUndefined();
  });
});

function dispatcherFor(options: {
  connection?: Record<string, unknown> | null;
  clickRow?: any;
  response?: { status: number; body: unknown } | Error;
}) {
  const connection =
    options.connection === null
      ? null
      : { metaLeadEnabled: true, metaPixelId: "1075406568726436", metaTestEventCode: null, ...options.connection };
  const prisma = {
    trackingIngestConnection: { findUnique: vi.fn(async () => connection) },
    trackingEvent: { findFirst: vi.fn(async () => options.clickRow ?? null) },
    trackingContactMatch: { update: vi.fn(async () => ({})) },
  };
  const fetchFn = vi.fn(async () => {
    if (options.response instanceof Error) throw options.response;
    const response = options.response ?? { status: 200, body: { events_received: 1, fbtrace_id: "trace" } };
    return new Response(JSON.stringify(response.body), { status: response.status });
  });
  const routes = { resolveCapiRoute: vi.fn(async () => ({ accessToken: "secret-token", pixelId: "999" })) };
  const service = new TrackingLeadDispatcherService(prisma as any, {}, fetchFn as any, routes as any);
  return { service, fetchFn, prisma };
}

const pending = {
  id: "m1",
  workspaceId: "ws_1",
  refToken: "CV-A7K9M2",
  metaEventId: "rtd_lead_abc",
  messageAt: new Date("2026-11-26T17:59:00Z"),
  createdAt: new Date("2026-11-26T17:59:05Z"),
  phoneHashes: [sha("5548991234567")],
  contactName: null,
  attempts: 0,
  trackingEvent: click(),
} as any;

describe("despacho do Lead", () => {
  it("envia ao pixel configurado e marca como enviado", async () => {
    const { service, fetchFn } = dispatcherFor({});
    const outcome = await service.dispatch(pending, NOW);
    expect(outcome).toMatchObject({ status: "sent", responseSummary: { events_received: 1 } });
    const [url, init] = fetchFn.mock.calls[0] as any;
    expect(url).toContain("/1075406568726436/events");
    expect(JSON.parse(init.body).data[0]).toMatchObject({ event_name: "Lead", action_source: "website" });
  });

  it("não envia com o envio desligado, sem user agent ou fora da janela de 7 dias", async () => {
    expect(await dispatcherFor({ connection: { metaLeadEnabled: false } }).service.dispatch(pending, NOW)).toMatchObject({
      status: "disabled",
    });
    expect(
      await dispatcherFor({}).service.dispatch({ ...pending, trackingEvent: click({ userAgent: null }) }, NOW),
    ).toMatchObject({ status: "skipped" });
    expect(
      await dispatcherFor({}).service.dispatch(pending, new Date("2026-12-04T18:00:00Z")),
    ).toMatchObject({ status: "expired" });
  });

  it("espera o clique por 15 minutos e depois desiste", async () => {
    const waiting = { ...pending, trackingEvent: null };
    expect(await dispatcherFor({}).service.dispatch(waiting, NOW)).toMatchObject({ status: "retry" });
    expect(
      await dispatcherFor({}).service.dispatch(waiting, new Date("2026-11-26T18:30:00Z")),
    ).toMatchObject({ status: "no_click" });
    const relinked = dispatcherFor({ clickRow: click() });
    expect(await relinked.service.dispatch(waiting, NOW)).toMatchObject({ status: "sent" });
    expect(relinked.prisma.trackingContactMatch.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { trackingEventId: "evt_click" },
    });
  });

  it("tenta de novo em erro temporário e falha em recusa definitiva", async () => {
    expect(
      await dispatcherFor({ response: { status: 500, body: {} } }).service.dispatch(pending, NOW),
    ).toMatchObject({ status: "retry" });
    expect(await dispatcherFor({ response: new TypeError("fetch failed") }).service.dispatch(pending, NOW)).toMatchObject({
      status: "retry",
    });
    expect(
      await dispatcherFor({ response: { status: 400, body: { error: { message: "Invalid parameter" } } } }).service.dispatch(
        pending,
        NOW,
      ),
    ).toMatchObject({ status: "failed", error: "Invalid parameter" });
  });

  it("não grava o token de acesso no resumo da resposta", async () => {
    const outcome = await dispatcherFor({ response: { status: 400, body: { error: { message: "x" } } } }).service.dispatch(
      pending,
      NOW,
    );
    expect(JSON.stringify(outcome)).not.toContain("secret-token");
  });
});
