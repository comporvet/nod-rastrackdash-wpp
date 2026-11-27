import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AcquisitionFunnelService,
  customerSplit,
  googleAdsApply,
  metaAdsApply,
  parseFunnelFilters,
  passes,
  scheduledLeads,
} from "../../src/tracking/acquisition-funnel.service";
import { parseComporvetDate, phonesOf } from "../../src/tracking/comporvet-data.service";
import type { CollectedLead } from "../../src/tracking/lead-origin.service";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function lead(overrides: Partial<CollectedLead> = {}): CollectedLead {
  return {
    at: "2026-11-27T15:00:00.000Z",
    entry: "lp_online",
    name: null,
    channel: "google_ads",
    group: "paid",
    confidence: "confirmed",
    campaign: null,
    firstTouch: null,
    lastNonDirect: null,
    visits: 1,
    refToken: null,
    phoneHashes: [sha("5548991234567")],
    metaCampaignId: null,
    ...overrides,
  };
}

describe("dados da Comporvet", () => {
  it("lê datas do SimplesVet e ISO", () => {
    expect(parseComporvetDate("05/11/2026")).toBe("2026-11-05");
    expect(parseComporvetDate("5/1/2026 10:30")).toBe("2026-01-05");
    expect(parseComporvetDate("2026-11-27")).toBe("2026-11-27");
    expect(parseComporvetDate("")).toBeNull();
    expect(parseComporvetDate(null)).toBeNull();
  });

  it("separa vários telefones e descarta valores curtos", () => {
    expect(phonesOf("(48) 99123-4567, 48 3333-4444; 123")).toEqual(["(48) 99123-4567", "48 3333-4444"]);
    expect(phonesOf(null)).toEqual([]);
  });
});

describe("filtros do funil", () => {
  it("valida os valores e as campanhas", () => {
    expect(parseFunnelFilters({})).toEqual({ group: "all", channel: "all", entry: "all", campaignIds: [] });
    expect(parseFunnelFilters({ campaignIds: "123, 456,bad id" }).campaignIds).toEqual(["123", "456"]);
    expect(() => parseFunnelFilters({ group: "x" })).toThrow();
  });

  it("aplica grupo, canal, entrada e campanha", () => {
    const filters = parseFunnelFilters({ group: "paid", entry: "lp_online" });
    expect(passes(filters, { channel: "google_ads", entry: "lp_online", campaigns: [] })).toBe(true);
    expect(passes(filters, { channel: "direct", entry: "lp_online", campaigns: [] })).toBe(false);
    expect(passes(filters, { channel: "google_ads", entry: "site", campaigns: [] })).toBe(false);
    const byCampaign = parseFunnelFilters({ campaignIds: "c1" });
    expect(passes(byCampaign, { channel: "meta_ctwa", entry: "ctwa", campaigns: ["c1"] })).toBe(true);
    expect(passes(byCampaign, { channel: "meta_ctwa", entry: "ctwa", campaigns: [null] })).toBe(false);
  });

  it("métricas da Meta só valem para pago Meta sem filtro de página", () => {
    expect(metaAdsApply(parseFunnelFilters({}))).toBe(true);
    expect(metaAdsApply(parseFunnelFilters({ group: "organic" }))).toBe(false);
    expect(metaAdsApply(parseFunnelFilters({ channel: "google_ads" }))).toBe(false);
    expect(metaAdsApply(parseFunnelFilters({ entry: "site" }))).toBe(false);
    expect(googleAdsApply(parseFunnelFilters({ entry: "lp_presencial" }))).toBe(true);
    expect(googleAdsApply(parseFunnelFilters({ entry: "ctwa" }))).toBe(false);
  });
});

describe("agendamentos e clientes", () => {
  const hash = sha("5548991234567");

  it("conta agendamento criado no dia do contato ou depois, ignorando cancelados", () => {
    const appointments = {
      status: "ok" as const,
      byHash: new Map([
        [hash, [{ createdAt: new Date("2026-11-27T18:00:00Z"), startsAt: null, status: "agendado" }]],
        [sha("5548988887777"), [{ createdAt: new Date("2026-11-28T12:00:00Z"), startsAt: null, status: "cancelado" }]],
        [sha("5548977776666"), [{ createdAt: new Date("2026-11-20T12:00:00Z"), startsAt: null, status: "agendado" }]],
      ]),
    };
    const result = scheduledLeads(
      [
        lead(),
        lead({ phoneHashes: [sha("5548988887777")] }),
        lead({ phoneHashes: [sha("5548977776666")] }),
      ],
      appointments,
    );
    expect(result).toHaveLength(1);
  });

  it("cliente novo = primeira compra no dia do contato ou depois; o resto já era cliente", () => {
    const customers = {
      status: "ok" as const,
      firstPurchaseByHash: new Map([
        [hash, "2026-11-27"],
        [sha("5548988887777"), "2025-03-10"],
      ]),
    };
    const split = customerSplit(
      [lead(), lead({ phoneHashes: [sha("5548988887777")] }), lead({ phoneHashes: [sha("5548900000000")] })],
      customers,
    );
    expect(split.fresh).toHaveLength(1);
    expect(split.existing).toHaveLength(1);
  });
});

describe("funil completo", () => {
  function service(options: { customers?: string; appointments?: string } = {}) {
    const t = (iso: string) => new Date(iso);
    const prisma = {
      metaCampaignDailyInsight: {
        aggregate: vi.fn(async () => ({
          _sum: { impressions: 10_000, linkClicks: 300, spendCents: 50_000, metaConversationsStarted: 12 },
        })),
      },
      trackingEvent: {
        findMany: vi.fn(async (args: any) => {
          const all = [
            { clientId: "c1", eventName: "page_view", environment: "lp_online", eventTime: t("2026-11-27T12:00:00Z"), sessionId: "s1", pageReferrerHost: null, attribution: { gclid: "g" } },
            { clientId: "c1", eventName: "click_whatsapp", environment: "lp_online", eventTime: t("2026-11-27T12:01:00Z"), sessionId: "s1", pageReferrerHost: null, attribution: {} },
            { clientId: "c2", eventName: "page_view", environment: "site", eventTime: t("2026-11-27T13:00:00Z"), sessionId: "s2", pageReferrerHost: "www.google.com", attribution: {} },
            { clientId: "c3", eventName: "page_view", environment: "site", eventTime: t("2026-11-27T13:00:00Z"), sessionId: "s3", pageReferrerHost: "tagassistant.google.com", attribution: {} },
          ];
          if (args.where.eventName) return all.filter((event) => args.where.eventName.in.includes(event.eventName));
          if (args.where.clientId?.in) return all.filter((event) => args.where.clientId.in.includes(event.clientId));
          return all;
        }),
      },
    };
    const origins = {
      collect: vi.fn(async () => [
        lead({ entry: "lp_online", channel: "google_ads", group: "paid" }),
        lead({ entry: "ctwa", channel: "meta_ctwa", group: "paid", phoneHashes: [sha("5548988887777")], metaCampaignId: "c1" }),
        lead({ entry: "whatsapp_direct", channel: "whatsapp_direct", group: "organic", phoneHashes: [sha("5548977776666")] }),
      ]),
    };
    const comporvet = {
      customers: vi.fn(async () =>
        options.customers === "not_configured"
          ? { status: "not_configured", firstPurchaseByHash: new Map() }
          : { status: "ok", firstPurchaseByHash: new Map([[sha("5548991234567"), "2026-11-28"]]) },
      ),
      appointments: vi.fn(async () => ({
        status: options.appointments ?? "ok",
        byHash: new Map([[sha("5548991234567"), [{ createdAt: new Date("2026-11-27T20:00:00Z"), startsAt: null, status: "agendado" }]]]),
      })),
    };
    return new AcquisitionFunnelService(prisma as any, origins as any, comporvet as any);
  }

  it("monta as sete etapas para todo o tráfego", async () => {
    const result = await service().funnel("ws_1", { since: "2026-11-27", until: "2026-11-27" });
    const values = Object.fromEntries(result.stages.map((stage) => [stage.key, stage.value]));
    expect(values).toEqual({
      impressions: 10_000,
      ad_clicks: 301,
      visits: 2,
      whatsapp_clicks: 1,
      conversations: 3,
      scheduled: 1,
      customers: 1,
    });
    expect(result.spendCents).toBe(50_000);
  });

  it("orgânico não tem impressões nem cliques de anúncio", async () => {
    const result = await service().funnel("ws_1", { since: "2026-11-27", until: "2026-11-27", group: "organic" });
    const values = Object.fromEntries(result.stages.map((stage) => [stage.key, stage.value]));
    expect(values).toMatchObject({ impressions: null, ad_clicks: null, visits: 1, whatsapp_clicks: 0, conversations: 1 });
    expect(result.spendCents).toBeNull();
  });

  it("sem acesso ao banco da Comporvet, agendamentos e clientes ficam indisponíveis", async () => {
    const result = await service({ customers: "not_configured", appointments: "missing_table" }).funnel("ws_1", {
      since: "2026-11-27",
      until: "2026-11-27",
    });
    const scheduled = result.stages.find((stage) => stage.key === "scheduled")!;
    const customers = result.stages.find((stage) => stage.key === "customers")!;
    expect(scheduled.value).toBeNull();
    expect(scheduled.note).toContain("ainda não existe");
    expect(customers.value).toBeNull();
    expect(customers.note).toContain("COMPORVET_DATABASE_URL");
  });
});
