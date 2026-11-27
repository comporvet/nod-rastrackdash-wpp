import { describe, expect, it } from "vitest";
import { funnelRows, isFunnelData, percent, trapezoid } from "../src/app/(app)/overview/acquisition-funnel-model";

const stage = (key: string, value: number | null) => ({ key, label: key, value, note: null, breakdown: [] });

describe("funil de aquisição", () => {
  it("calcula taxas sobre a etapa anterior disponível e o custo por etapa", () => {
    const rows = funnelRows({
      spendCents: 100_000,
      stages: [stage("impressions", 10_000), stage("ad_clicks", 500), stage("visits", null), stage("conversations", 50)],
    });
    expect(rows[1]!.fromPrevious).toBeCloseTo(0.05);
    expect(rows[2]!.fromPrevious).toBeNull();
    expect(rows[3]!.fromPrevious).toBeCloseTo(0.1);
    expect(rows[0]!.costCents).toBeNull();
    expect(rows[3]!.costCents).toBe(2_000);
  });

  it("larguras em escala logarítmica, com mínimo para etapas vazias", () => {
    const rows = funnelRows({ spendCents: null, stages: [stage("a", 10_000), stage("b", 3), stage("c", null)] });
    expect(rows[0]!.width).toBe(1);
    expect(rows[1]!.width).toBeGreaterThan(0.22);
    expect(rows[1]!.width).toBeLessThan(0.6);
    expect(rows[2]!.width).toBe(0.22);
    expect(trapezoid(rows, 0, 14).split(" ")).toHaveLength(4);
  });

  it("quem entra no meio soma no total da etapa, mas o desenho nunca alarga", () => {
    const rows = funnelRows({
      spendCents: null,
      stages: [
        stage("ad_clicks", 0),
        { ...stage("visits", 0), entered: [{ label: "Busca orgânica", value: 14 }] },
        stage("whatsapp_clicks", 3),
      ],
    });
    expect(rows[1]!.total).toBe(14);
    expect(rows[1]!.enteredTotal).toBe(14);
    expect(rows[1]!.width).toBeLessThanOrEqual(rows[0]!.width);
    expect(rows[2]!.fromPrevious).toBeCloseTo(3 / 14);
    expect(rows[2]!.previousTotal).toBe(14);
    expect(rows[2]!.width).toBeLessThanOrEqual(rows[1]!.width);
  });

  it("valida a resposta da API e formata percentuais", () => {
    expect(isFunnelData({ stages: [], filters: {} })).toBe(true);
    expect(isFunnelData({ businesses: [] })).toBe(false);
    expect(percent(0.005)).toBe("0,5%");
    expect(percent(null)).toBe("—");
  });
});
