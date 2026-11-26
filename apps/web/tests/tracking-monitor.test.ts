import { describe, expect, it } from "vitest";
import {
  coverage,
  dateTime,
  environmentMatrix,
  latency,
} from "../src/app/(app)/analytics/tracking/tracking-types";

describe("Tracking Monitor", () => {
  it("monta a matriz ambiente x evento na ordem dos ambientes", () => {
    const matrix = environmentMatrix([
      { environment: "unknown", eventName: "page_view", count: 1 },
      { environment: "lp_online", eventName: "click_whatsapp", count: 2 },
      { environment: "site", eventName: "page_view", count: 5 },
    ]);
    expect(matrix.eventNames).toEqual(["click_whatsapp", "page_view"]);
    expect(matrix.rows).toEqual([
      { environment: "site", counts: [0, 5] },
      { environment: "lp_online", counts: [2, 0] },
      { environment: "unknown", counts: [0, 1] },
    ]);
  });

  it("formata cobertura, latência e horário de São Paulo", () => {
    expect(coverage(null)).toBe("—");
    expect(coverage(0.5)).toBe("50%");
    expect(latency(250)).toBe("250 ms");
    expect(latency(1_500)).toBe("1,5 s");
    expect(dateTime("2026-11-26T18:00:00.000Z")).toContain("15:00:00");
  });
});
