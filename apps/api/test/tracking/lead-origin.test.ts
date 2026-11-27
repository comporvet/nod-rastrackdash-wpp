import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { LeadOriginService, siteLeadOrigin, summarize } from "../../src/tracking/lead-origin.service";
import { classifyLanding, resolveOrigin, sessionTouches, type TouchEvent } from "../../src/tracking/traffic-origin";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const DAY = 86_400_000;
const T = new Date("2026-11-27T15:00:00Z");

function ev(overrides: Partial<TouchEvent> & { minutesAgo?: number } = {}): TouchEvent {
  const { minutesAgo = 0, ...rest } = overrides;
  return {
    eventTime: new Date(T.getTime() - minutesAgo * 60_000),
    sessionId: "s1",
    environment: "lp_online",
    pageReferrerHost: null,
    attribution: {},
    ...rest,
  };
}

describe("classificação da página de entrada", () => {
  it.each([
    [{ attribution: { gclid: "abc" } }, "google_ads", "confirmed"],
    [{ attribution: { wbraid: "x" } }, "google_ads", "confirmed"],
    [{ attribution: { utm_source: "google", utm_medium: "cpc" } }, "google_ads", "confirmed"],
    [{ attribution: { utm_source: "Instagram", utm_medium: "paid_social" } }, "meta_ads", "confirmed"],
    [{ attribution: { utm_source: "fb", utm_medium: "paid" } }, "meta_ads", "confirmed"],
    [{ attribution: { fbclid: "IwAR1" } }, "meta_ads", "probable"],
    [{ pageReferrerHost: "www.google.com" }, "organic_search", null],
    [{ pageReferrerHost: "www.bing.com" }, "organic_search", null],
    [{ pageReferrerHost: "l.instagram.com" }, "organic_social", null],
    [{ pageReferrerHost: "lm.facebook.com" }, "organic_social", null],
    [{ attribution: { utm_source: "instagram", utm_medium: "social" } }, "organic_social", null],
    [{ attribution: { utm_source: "newsletter", utm_medium: "email" } }, "other", null],
    [{ pageReferrerHost: "petsite.com.br" }, "referral", null],
    [{ pageReferrerHost: "consultas.comporvet.com.br" }, "direct", null],
    [{ pageReferrerHost: "www.comporvet.com.br" }, "direct", null],
    [{}, "direct", null],
  ] as const)("%j -> %s", (input, channel, confidence) => {
    const touch = classifyLanding(ev(input as Partial<TouchEvent>));
    expect(touch.channel).toBe(channel);
    expect(touch.confidence).toBe(confidence);
    expect(touch.group).toBe(channel === "google_ads" || channel === "meta_ads" ? "paid" : "organic");
  });

  it("ignora o cookie fbc: visita direta posterior não vira Meta Ads", () => {
    expect(classifyLanding(ev({ attribution: { fbc: "fb.1.1.IwAR", fbp: "fb.1.1.2" } })).channel).toBe("direct");
  });

  it("guarda a campanha da UTM", () => {
    expect(
      classifyLanding(ev({ attribution: { gclid: "g", utm_campaign: "consulta-online" } })).campaign,
    ).toBe("consulta-online");
  });
});

describe("sessões", () => {
  it("usa só o primeiro evento de cada sessão e descarta sessões de teste", () => {
    const touches = sessionTouches([
      ev({ sessionId: "a", minutesAgo: 60, attribution: { gclid: "g" } }),
      ev({ sessionId: "a", minutesAgo: 59 }),
      ev({ sessionId: "b", minutesAgo: 10, pageReferrerHost: "tagassistant.google.com" }),
      ev({ sessionId: "c", minutesAgo: 5, pageReferrerHost: "l.instagram.com" }),
    ]);
    expect(touches.map((item) => item.channel)).toEqual(["google_ads", "organic_social"]);
  });

  it("sem session_id, separa por intervalo de 30 minutos", () => {
    const touches = sessionTouches([
      ev({ sessionId: null, minutesAgo: 120, attribution: { fbclid: "x" } }),
      ev({ sessionId: null, minutesAgo: 110 }),
      ev({ sessionId: null, minutesAgo: 20 }),
    ]);
    expect(touches.map((item) => item.channel)).toEqual(["meta_ads", "direct"]);
  });
});

describe("origem do lead (primeiro contato)", () => {
  it("anúncio Google e volta direta dias depois: origem Google Ads", () => {
    const origin = resolveOrigin([
      ev({ sessionId: "1", minutesAgo: 3 * 24 * 60, attribution: { gclid: "g" }, environment: "site" }),
      ev({ sessionId: "2", minutesAgo: 2 }),
    ]);
    expect(origin.first?.channel).toBe("google_ads");
    expect(origin.first?.environment).toBe("site");
    expect(origin.lastNonDirect?.channel).toBe("google_ads");
    expect(origin.visits).toBe(2);
  });

  it("entrada direta e depois anúncio da Meta: principal direto, último não direto Meta", () => {
    const origin = resolveOrigin([
      ev({ sessionId: "1", minutesAgo: 600 }),
      ev({ sessionId: "2", minutesAgo: 5, attribution: { utm_source: "facebook", utm_medium: "paid_social" } }),
    ]);
    expect(origin.first?.channel).toBe("direct");
    expect(origin.lastNonDirect?.channel).toBe("meta_ads");
  });

  it("descarta visitas fora da janela de 90 dias", () => {
    const row = siteLeadOrigin(
      { messageAt: T, contactName: "Maria", refToken: "CV-AAAAAA", clickEnvironment: "lp_online" },
      [
        ev({ sessionId: "old", minutesAgo: 91 * 24 * 60, attribution: { gclid: "g" } }),
        ev({ sessionId: "new", minutesAgo: 3 }),
      ],
    );
    expect(row).toMatchObject({ channel: "direct", group: "organic", visits: 1, entry: "lp_online" });
  });

  it("sem visitas conhecidas: origem desconhecida, grupo orgânico", () => {
    const row = siteLeadOrigin({ messageAt: T, contactName: null, refToken: "CV-BBBBBB", clickEnvironment: null }, []);
    expect(row).toMatchObject({ channel: "unknown", group: "organic", entry: "unknown_page", visits: 0 });
  });

  it("resume por grupo e canal contando as prováveis", () => {
    const base = { at: T.toISOString(), entry: "site" as const, name: null, campaign: null, firstTouch: null, lastNonDirect: null, visits: 1, refToken: null };
    const summary = summarize([
      { ...base, channel: "meta_ads", group: "paid", confidence: "probable" },
      { ...base, channel: "meta_ads", group: "paid", confidence: "confirmed" },
      { ...base, channel: "google_ads", group: "paid", confidence: "confirmed" },
      { ...base, channel: "whatsapp_direct", group: "organic", confidence: null },
    ]);
    expect(summary).toMatchObject({ total: 4, paid: 3, organic: 1 });
    expect(summary.byChannel[0]).toEqual({ channel: "meta_ads", count: 2, probable: 1 });
  });
});

describe("relatório de origem", () => {
  const phone = "5548991234567";
  const phoneHash = sha(phone);
  const otherHash = sha("5548988887777");
  const ctwaHash = sha("5548977776666");
  const oldHash = sha("5548966665555");

  function service() {
    const prisma = {
      trackingContactMatch: {
        findMany: vi.fn(async (args: any) =>
          args.where.messageAt
            ? [
                {
                  refToken: "CV-AAAAAA",
                  messageAt: new Date(T.getTime() - 60_000),
                  contactName: "Maria",
                  phoneHashes: [phoneHash, sha("554891234567")],
                  trackingEvent: { clientId: "c1", environment: "lp_online" },
                },
                {
                  refToken: "CV-CCCCCC",
                  messageAt: new Date(T.getTime() - 120_000),
                  contactName: "João",
                  phoneHashes: [ctwaHash],
                  trackingEvent: { clientId: "c2", environment: "site" },
                },
              ]
            : [{ phoneHashes: [phoneHash] }, { phoneHashes: [ctwaHash] }],
        ),
      },
      trackingEvent: {
        findMany: vi.fn(async () => [
          { clientId: "c1", eventTime: new Date(T.getTime() - 2 * DAY), sessionId: "1", environment: "site", pageReferrerHost: null, attribution: { gclid: "g", utm_campaign: "busca" } },
          { clientId: "c1", eventTime: new Date(T.getTime() - 5 * 60_000), sessionId: "2", environment: "lp_online", pageReferrerHost: null, attribution: {} },
        ]),
      },
      lead: {
        findMany: vi.fn(async () => [
          { name: "Ana", phoneHash: ctwaHash, campaignId: "cmp1", firstMessageAt: new Date(T.getTime() - 3_600_000), createdAt: T },
        ]),
      },
      metaCampaign: { findMany: vi.fn(async () => [{ campaignId: "cmp1", name: "Consulta online" }]) },
      inboundWebhookEvent: {
        groupBy: vi.fn(async () => [
          { contactIdentityHash: phoneHash, _min: { occurredAt: new Date(T.getTime() - 60_000) } },
          { contactIdentityHash: otherHash, _min: { occurredAt: new Date(T.getTime() - 30 * 60_000) } },
          { contactIdentityHash: oldHash, _min: { occurredAt: new Date("2026-11-06T12:00:00Z") } },
          { contactIdentityHash: ctwaHash, _min: { occurredAt: new Date(T.getTime() - 3_600_000) } },
        ]),
        findMany: vi.fn(async () => [{ contactIdentityHash: ctwaHash }]),
      },
    };
    return { prisma, service: new LeadOriginService(prisma as any) };
  }

  it("junta CTWA, contatos do site com origem recuperada e WhatsApp direto, sem duplicar telefone", async () => {
    const { service: origins } = service();
    const report = await origins.report("ws_1", { since: "2026-11-27", until: "2026-11-27" });
    const byChannel = Object.fromEntries(report.rows.map((row) => [row.channel, row]));
    expect(report.total).toBe(3);
    expect(report.paid).toBe(2);
    expect(byChannel.meta_ctwa).toMatchObject({ entry: "ctwa", campaign: "Consulta online", name: "Ana" });
    expect(byChannel.google_ads).toMatchObject({ entry: "lp_online", campaign: "busca", visits: 2, refToken: "CV-AAAAAA" });
    expect(byChannel.whatsapp_direct).toMatchObject({ group: "organic", name: null });
    expect(report.rows.some((row) => row.refToken === "CV-CCCCCC")).toBe(false);
  });
});
