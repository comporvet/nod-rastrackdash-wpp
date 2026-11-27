import { describe, expect, it } from "vitest";
import {
  channelCounts,
  filterRows,
  organicChannels,
  paidChannels,
  share,
  touchText,
  type LeadOriginRow,
} from "../src/app/(app)/analytics/origins/origins-types";

const row = (overrides: Partial<LeadOriginRow>): LeadOriginRow => ({
  at: "2026-11-27T12:00:00.000Z",
  entry: "lp_online",
  name: null,
  channel: "direct",
  group: "organic",
  confidence: null,
  campaign: null,
  firstTouch: null,
  lastNonDirect: null,
  visits: 1,
  refToken: null,
  ...overrides,
});

describe("Origem dos leads", () => {
  it("lista todos os canais pagos e orgânicos, com zero quando não há leads", () => {
    const report = { byChannel: [{ channel: "meta_ads", count: 2, probable: 1 }] };
    expect(channelCounts(report, paidChannels)).toEqual([
      { channel: "google_ads", count: 0, probable: 0 },
      { channel: "meta_ads", count: 2, probable: 1 },
      { channel: "meta_ctwa", count: 0, probable: 0 },
    ]);
    expect(channelCounts(report, organicChannels)).toHaveLength(7);
  });

  it("filtra por grupo e por canal", () => {
    const rows = [row({ channel: "google_ads", group: "paid" }), row({}), row({ channel: "whatsapp_direct" })];
    expect(filterRows(rows, { group: "paid" })).toHaveLength(1);
    expect(filterRows(rows, { channel: "whatsapp_direct" })).toHaveLength(1);
    expect(filterRows(rows, {})).toHaveLength(3);
  });

  it("formata participação e ponto de contato", () => {
    expect(share(1, 3)).toBe("33,3%");
    expect(share(0, 0)).toBe("—");
    expect(
      touchText({ channel: "google_ads", confidence: "confirmed", campaign: "busca", source: null, medium: null, environment: "site", at: "" }),
    ).toBe("Google Ads · busca");
    expect(touchText(null)).toBe("—");
  });
});
