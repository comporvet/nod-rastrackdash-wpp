import { describe, expect, it } from "vitest";
import {
  METRICS,
  expandedToLevel,
  formatMetric,
  sumMetrics,
  visibleMetrics,
  type OptimizationMetrics,
  type OptimizationNode,
} from "../src/app/(app)/reports/optimization-model";

const metrics = (overrides: Partial<OptimizationMetrics> = {}): OptimizationMetrics => ({
  currency: "BRL",
  spendCents: 100_000,
  impressions: 50_000,
  reach: 20_000,
  linkClicks: 500,
  videoViews: 10_000,
  landingPageViews: 400,
  metaConversations: 60,
  conversations: 50,
  qualifiedLeads: 20,
  purchases: 10,
  firstPurchases: 8,
  revenueCents: 500_000,
  firstPurchaseRevenueCents: 400_000,
  repurchaseRevenueCents: 160_000,
  ...overrides,
});

const value = (key: string, m: OptimizationMetrics) => METRICS.find((metric) => metric.key === key)!.value(m);

describe("métricas do guia", () => {
  it("calcula as fórmulas", () => {
    const m = metrics();
    expect(value("cpm", m)).toBe(2000);
    expect(value("frequency", m)).toBe(2.5);
    expect(value("ctr", m)).toBe(0.01);
    expect(value("cpc", m)).toBe(200);
    expect(value("hookRate", m)).toBe(0.2);
    expect(value("connectRate", m)).toBe(0.8);
    expect(value("clickToConversation", m)).toBe(0.1);
    expect(value("costPerConversation", m)).toBe(2000);
    expect(value("leadQuality", m)).toBe(0.4);
    expect(value("cpa", m)).toBe(10_000);
    expect(value("averageTicket", m)).toBe(50_000);
    expect(value("roas", m)).toBe(5);
    expect(value("ltv", m)).toBe(70_000);
  });

  it("sem base, a métrica fica vazia em vez de zero", () => {
    const m = metrics({ impressions: 0, linkClicks: 0, videoViews: 0, landingPageViews: 0, purchases: 0, firstPurchases: 0 });
    for (const key of ["cpm", "ctr", "cpc", "hookRate", "connectRate", "cpa", "averageTicket", "ltv"]) {
      expect(value(key, m)).toBeNull();
    }
    expect(formatMetric(null, "money", "BRL")).toBe("—");
  });

  it("toda métrica tem explicação", () => {
    for (const metric of METRICS) expect(metric.help.length).toBeGreaterThan(30);
  });

  it("categoria recolhida mantém só a métrica principal", () => {
    const keys = visibleMetrics(new Set(["delivery", "sales"])).map((metric) => metric.key);
    expect(keys).toContain("spend");
    expect(keys).not.toContain("cpm");
    expect(keys).toContain("roas");
    expect(keys).not.toContain("cpa");
    expect(keys).toContain("ctr");
    expect(keys).toContain("cpc");
  });

  it("abre a árvore até o nível escolhido e soma o total", () => {
    const ad: OptimizationNode = { id: "a1", name: "A", level: "ad", status: null, metrics: metrics(), children: [] };
    const adSet: OptimizationNode = { id: "s1", name: "S", level: "adset", status: null, metrics: metrics(), children: [ad] };
    const campaign: OptimizationNode = { id: "c1", name: "C", level: "campaign", status: null, metrics: metrics(), children: [adSet] };
    expect(expandedToLevel([campaign], "campaign")).toEqual([]);
    expect(expandedToLevel([campaign], "adset")).toEqual(["c1"]);
    expect(expandedToLevel([campaign], "ad")).toEqual(["c1", "s1"]);
    expect(sumMetrics([campaign, campaign]).spendCents).toBe(200_000);
  });

  it("formata moeda, percentual e multiplicador", () => {
    expect(formatMetric(2000, "money", "BRL")).toMatch(/R\$\s?20,00/);
    expect(formatMetric(0.0123, "percent", null)).toBe("1,23%");
    expect(formatMetric(5, "ratio", null)).toBe("5x");
  });
});
