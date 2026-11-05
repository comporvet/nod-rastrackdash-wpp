import { describe, expect, it } from "vitest";
import type { ProviderConversionAutomationObservationResult } from "../../src/conversion-rules/provider-conversion-observation.service";
import { createHarness, input } from "../fase4-payt/payt-ingestion-harness";

const paid = {
  event: "sale.paid",
  sale: {
    id: "1234-20261105",
    paidAt: "2026-11-05T12:00:00-03:00",
    value: 400,
    phones: ["48999990000"],
  },
};

function simplesvetHarness() {
  const harness = createHarness({
    eventName: "Purchase",
    production: true,
    payt: true,
  });
  const rule = harness.endpoint.providerRule as any;
  rule.parserRelease.provider = "simplesvet";
  rule.parserReleaseId = "inbound_parser_simplesvet_automation_v1";
  rule.parserRelease.id = "inbound_parser_simplesvet_automation_v1";
  return harness;
}

const body = (payload: unknown) => input(Buffer.from(JSON.stringify(payload)));

const blocked = {
  decisionId: null,
  decisionCode: null,
  reasonCode: "payt_channel_missing_or_ambiguous",
  disposition: "blocked",
  executionId: null,
  eligibleExecutionId: null,
  reviewId: null,
  channelId: null,
  leadResolved: false,
} as ProviderConversionAutomationObservationResult;

describe("SimplesVet pipeline", () => {
  it("observes a paid sale as the Purchase of the rule", async () => {
    const harness = simplesvetHarness();
    const result = await harness.service.ingest(body(paid));
    expect(result.duplicate).toBe(false);
    expect(
      (harness.conversionObservation.observeAutomation as any).mock.calls.at(
        -1,
      )![0].automation,
    ).toMatchObject({
      provider: "simplesvet",
      eventName: "Purchase",
      valueCents: 40000,
      currency: "BRL",
      orderRef: "1234-20261105",
    });
  });

  it("ignores another event, never an error", async () => {
    const harness = simplesvetHarness();
    const result = await harness.service.ingest(
      body({ ...paid, event: "sale.cancelled" }),
    );
    expect(result.observationStatus).toBe("ignored");
    expect(
      harness.conversionObservation.observeAutomation,
    ).not.toHaveBeenCalled();
  });

  it("dedupes a resent sale into the same delivery", async () => {
    const harness = simplesvetHarness();
    (
      harness.conversionObservation.observeAutomation as any
    ).mockResolvedValueOnce(blocked);
    const first = await harness.service.ingest(body(paid));
    const resend = await harness.service.ingest(body(paid));
    expect(resend).toMatchObject({
      deliveryId: first.deliveryId,
      duplicate: true,
    });
  });
});
