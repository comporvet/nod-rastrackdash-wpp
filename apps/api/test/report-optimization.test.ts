import { describe, expect, it, vi } from "vitest";
import { ReportOptimizationService } from "../src/reporting/report-optimization.service";

const business = (overrides: Record<string, unknown>) => ({
  currency: "BRL",
  status: "active",
  effectiveStatus: "ACTIVE",
  spendCents: 0,
  metaConversationsStarted: 0,
  realConversations: 0,
  qualifiedLead: 0,
  purchases: 0,
  firstPurchases: 0,
  trafficRevenueCents: 0,
  firstPurchaseRevenueCents: 0,
  repurchaseRevenueCents: 0,
  ...overrides,
});

function service() {
  const reporting = {
    getCampaignReportOverview: vi.fn(async () => ({
      campaigns: [
        business({ id: "c1", name: "Campanha 1", spendCents: 10_000, realConversations: 4 }),
        business({ id: "c2", name: "Campanha 2", spendCents: 50_000 }),
      ],
    })),
    getAdSetReportOverview: vi.fn(async () => ({
      adSets: [
        business({ id: "s1", campaignId: "c1", name: "Conjunto 1", spendCents: 10_000 }),
        business({ id: "s9", campaignId: "c9", name: "Fora do filtro", spendCents: 1 }),
      ],
    })),
    getAdReportOverview: vi.fn(async () => ({
      ads: [
        business({ id: "a1", campaignId: "c1", adSetId: "s1", name: "Anúncio 1", spendCents: 3_000 }),
        business({ id: "a2", campaignId: "c1", adSetId: "s1", name: "Anúncio 2", spendCents: 7_000 }),
      ],
    })),
  };
  const sums = (impressions: number) => ({ impressions, reach: impressions / 2, linkClicks: 10, videoViews: 0, landingPageViews: 0 });
  const prisma = {
    metaCampaignDailyInsight: { groupBy: vi.fn(async () => [{ campaignId: "c1", _sum: sums(1000) }]) },
    metaAdSetDailyInsight: { groupBy: vi.fn(async () => [{ adSetId: "s1", _sum: sums(1000) }]) },
    metaAdDailyInsight: { groupBy: vi.fn(async () => [{ adId: "a2", _sum: sums(700) }]) },
  };
  return { reporting, prisma, service: new ReportOptimizationService(prisma as any, reporting as any) };
}

describe("métricas de otimização", () => {
  it("monta a árvore campanha > conjunto > anúncio com entrega e resultados", async () => {
    const { service: svc, prisma } = service();
    const report = await svc.report({ workspaceId: "ws", rangeLabel: "x", since: "2026-11-01", until: "2026-11-27" });

    expect(report.campaigns.map((node) => node.id)).toEqual(["c2", "c1"]);
    const c1 = report.campaigns[1]!;
    expect(c1.metrics).toMatchObject({ spendCents: 10_000, impressions: 1000, reach: 500, linkClicks: 10, conversations: 4 });
    expect(c1.children.map((node) => node.id)).toEqual(["s1"]);
    expect(c1.children[0]!.children.map((node) => node.id)).toEqual(["a2", "a1"]);
    expect(c1.children[0]!.children[1]!.metrics.impressions).toBe(0);
    expect(report.campaigns[0]!.children).toEqual([]);
    expect(prisma.metaAdSetDailyInsight.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ adSetId: { in: ["s1"] }, localDate: { gte: "2026-11-01", lte: "2026-11-27" } }) }),
    );
  });

  it("o filtro de campanhas vale só para a consulta de campanhas", async () => {
    const { service: svc, reporting } = service();
    await svc.report({ workspaceId: "ws", rangeLabel: "x", since: "2026-11-01", until: "2026-11-27", campaignIds: ["c1"] });
    expect(reporting.getCampaignReportOverview).toHaveBeenCalledWith(expect.objectContaining({ campaignIds: ["c1"] }));
    expect(reporting.getAdSetReportOverview).toHaveBeenCalledWith(expect.not.objectContaining({ campaignIds: expect.anything() }));
  });
});
