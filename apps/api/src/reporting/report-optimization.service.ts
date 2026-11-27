import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { MetaReportingService } from "./meta-reporting.service";

type MetaReportFilters = Parameters<MetaReportingService["getCampaignReportOverview"]>[0];

type BusinessMetrics = {
  currency?: string | null;
  status?: string;
  effectiveStatus?: string | null;
  spendCents: number;
  metaConversationsStarted: number;
  realConversations: number;
  qualifiedLead: number;
  purchases: number;
  firstPurchases: number;
  trafficRevenueCents: number;
  firstPurchaseRevenueCents: number;
  repurchaseRevenueCents: number;
};

export type DeliveryMetrics = {
  impressions: number;
  reach: number;
  linkClicks: number;
  videoViews: number;
  landingPageViews: number;
};

export type OptimizationMetrics = DeliveryMetrics & {
  currency: string | null;
  spendCents: number;
  metaConversations: number;
  conversations: number;
  qualifiedLeads: number;
  purchases: number;
  firstPurchases: number;
  revenueCents: number;
  firstPurchaseRevenueCents: number;
  repurchaseRevenueCents: number;
};

export type OptimizationNode = {
  id: string;
  name: string;
  level: "campaign" | "adset" | "ad";
  status: string | null;
  metrics: OptimizationMetrics;
  children: OptimizationNode[];
};

const EMPTY_DELIVERY: DeliveryMetrics = {
  impressions: 0,
  reach: 0,
  linkClicks: 0,
  videoViews: 0,
  landingPageViews: 0,
};

export function toMetrics(row: BusinessMetrics, delivery: DeliveryMetrics | undefined): OptimizationMetrics {
  return {
    ...(delivery ?? EMPTY_DELIVERY),
    currency: row.currency ?? null,
    spendCents: row.spendCents,
    metaConversations: row.metaConversationsStarted,
    conversations: row.realConversations,
    qualifiedLeads: row.qualifiedLead,
    purchases: row.purchases,
    firstPurchases: row.firstPurchases,
    revenueCents: row.trafficRevenueCents,
    firstPurchaseRevenueCents: row.firstPurchaseRevenueCents,
    repurchaseRevenueCents: row.repurchaseRevenueCents,
  };
}

type DeliverySums = { _sum: Partial<Record<keyof DeliveryMetrics, number | null>> };

function deliveryOf(sums: DeliverySums["_sum"]): DeliveryMetrics {
  return {
    impressions: sums.impressions ?? 0,
    reach: sums.reach ?? 0,
    linkClicks: sums.linkClicks ?? 0,
    videoViews: sums.videoViews ?? 0,
    landingPageViews: sums.landingPageViews ?? 0,
  };
}

const DELIVERY_SUM = {
  impressions: true,
  reach: true,
  linkClicks: true,
  videoViews: true,
  landingPageViews: true,
} as const;

@Injectable()
export class ReportOptimizationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MetaReportingService) private readonly reporting: MetaReportingService,
  ) {}

  async report(input: MetaReportFilters & { since: string; until: string }) {
    const { campaignIds, ...shared } = input;
    const [campaignReport, adSetReport, adReport] = await Promise.all([
      this.reporting.getCampaignReportOverview({ ...shared, ...(campaignIds?.length ? { campaignIds } : {}) }),
      this.reporting.getAdSetReportOverview(shared),
      this.reporting.getAdReportOverview(shared),
    ]);
    const campaignRows = campaignReport.campaigns;
    const kept = new Set(campaignRows.map((row) => row.id));
    const adSetRows = adSetReport.adSets.filter((row) => kept.has(row.campaignId));
    const adRows = adReport.ads.filter((row) => kept.has(row.campaignId));

    const where = (key: "campaignId" | "adSetId" | "adId", ids: string[]) => ({
      workspaceId: input.workspaceId,
      [key]: { in: ids },
      localDate: { gte: input.since, lte: input.until },
    });
    const [campaignDelivery, adSetDelivery, adDelivery] = await Promise.all([
      campaignRows.length
        ? this.prisma.metaCampaignDailyInsight.groupBy({
            by: ["campaignId"],
            where: where("campaignId", [...kept]),
            _sum: DELIVERY_SUM,
          })
        : [],
      adSetRows.length
        ? this.prisma.metaAdSetDailyInsight.groupBy({
            by: ["adSetId"],
            where: where("adSetId", adSetRows.map((row) => row.id)),
            _sum: DELIVERY_SUM,
          })
        : [],
      adRows.length
        ? this.prisma.metaAdDailyInsight.groupBy({
            by: ["adId"],
            where: where("adId", adRows.map((row) => row.id)),
            _sum: DELIVERY_SUM,
          })
        : [],
    ]);
    const byCampaign = new Map(campaignDelivery.map((row) => [row.campaignId, deliveryOf(row._sum)]));
    const byAdSet = new Map(adSetDelivery.map((row) => [row.adSetId, deliveryOf(row._sum)]));
    const byAd = new Map(adDelivery.map((row) => [row.adId, deliveryOf(row._sum)]));

    const adsByAdSet = new Map<string, OptimizationNode[]>();
    for (const row of adRows) {
      const list = adsByAdSet.get(row.adSetId) ?? [];
      list.push({
        id: row.id,
        name: row.name,
        level: "ad",
        status: row.effectiveStatus ?? row.status ?? null,
        metrics: toMetrics(row, byAd.get(row.id)),
        children: [],
      });
      adsByAdSet.set(row.adSetId, list);
    }
    const adSetsByCampaign = new Map<string, OptimizationNode[]>();
    for (const row of adSetRows) {
      const list = adSetsByCampaign.get(row.campaignId) ?? [];
      list.push({
        id: row.id,
        name: row.name,
        level: "adset",
        status: row.effectiveStatus ?? row.status ?? null,
        metrics: toMetrics(row, byAdSet.get(row.id)),
        children: bySpend(adsByAdSet.get(row.id) ?? []),
      });
      adSetsByCampaign.set(row.campaignId, list);
    }
    const campaigns: OptimizationNode[] = campaignRows.map((row) => ({
      id: row.id,
      name: row.name,
      level: "campaign",
      status: row.effectiveStatus ?? row.status ?? null,
      metrics: toMetrics(row, byCampaign.get(row.id)),
      children: bySpend(adSetsByCampaign.get(row.id) ?? []),
    }));

    return {
      since: input.since,
      until: input.until,
      campaigns: bySpend(campaigns),
    };
  }
}

function bySpend(nodes: OptimizationNode[]): OptimizationNode[] {
  return [...nodes].sort(
    (a, b) => b.metrics.spendCents - a.metrics.spendCents || a.name.localeCompare(b.name, "pt-BR"),
  );
}
