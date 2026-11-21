import { describe, expect, it } from "vitest";
import {
  comparisonCsv,
  comparisonRows,
  formatMetric,
  variation,
} from "../src/app/(app)/analytics/ga4-metrics";
import type { Ga4EnvironmentReport } from "../src/app/(app)/analytics/ga4-types";

const totals = {
  totalUsers: 18,
  activeUsers: 17,
  sessions: 20,
  screenPageViews: 40,
  engagedSessions: 10,
  engagementRate: 0.5,
  averageEngagementTimePerSession: 75,
};

function report(key: string, overrides: Partial<Ga4EnvironmentReport> = {}): Ga4EnvironmentReport {
  return {
    key,
    label: key,
    definition: { key, label: key, hostPattern: ".*" },
    core: {
      status: "ok",
      data: {
        totals: { current: totals, previous: { ...totals, sessions: 10 } },
        events: {
          current: { click_whatsapp: { eventCount: 2, totalUsers: 1 }, page_view: { eventCount: 40, totalUsers: 18 } },
          previous: null,
        },
        daily: [],
      },
    },
    scroll: { status: "ok", data: { byPage: [], milestones: [], otherValues: [] } },
    scrollUsers: { status: "ok", data: [{ percent: 50, totalUsers: 9 }, { percent: 90, totalUsers: 4 }] },
    acquisition: { status: "ok", data: null },
    funnel: {
      status: "ok",
      method: "funnel_report",
      data: { steps: [], progressionRate: 5.5556, byDevice: [] },
    },
    previousFunnel: null,
    ...overrides,
  };
}

describe("indicadores GA4", () => {
  it("usa denominadores explícitos e não inventa valor quando a seção falhou", () => {
    const failed = report("lp_online", { core: { status: "unauthorized", data: null } });
    const rows = comparisonRows([report("site"), failed]);
    const get = (key: string, env: string) => rows.find((row) => row.key === key)!.values[env]!;
    expect(get("clicksPer100Views", "site").current).toBe(5);
    expect(get("engagementRate", "site").current).toBe(50);
    expect(get("scroll50", "site").current).toBe(9);
    expect(get("sessions", "lp_online").current).toBeNull();
    expect(formatMetric(get("sessions", "lp_online").current, "integer")).toBe("—");
  });

  it("calcula variação só com base anterior válida", () => {
    expect(variation({ current: 20, previous: 10 })).toBe(100);
    expect(variation({ current: 20, previous: 0 })).toBeNull();
    expect(variation({ current: 20, previous: null })).toBeNull();
  });

  it("formata duração e percentuais", () => {
    expect(formatMetric(75, "seconds")).toBe("1min 15s");
    expect(formatMetric(5.5556, "percent")).toBe("5,6%");
  });

  it("exporta CSV com separador ; e rótulo dos ambientes", () => {
    const csv = comparisonCsv(comparisonRows([report("site")]), [report("site")], "01/11/2026 a 20/11/2026");
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Período;01/11/2026 a 20/11/2026");
    expect(lines[1]).toBe("Indicador;Fonte;site;site (anterior)");
    expect(lines.find((line) => line.startsWith("Sessões;"))).toBe("Sessões;GA4;20;10");
  });
});
