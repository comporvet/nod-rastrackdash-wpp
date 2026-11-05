import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProviderPurchaseIdentity } from "../../src/conversion-rules/provider-purchase-identity";
import {
  parseSimplesvetAutomationV1,
  parseSimplesvetSaleEventV1,
} from "../../src/inbound-webhooks/providers/simplesvet/simplesvet-automation-v1.parser";
import {
  isSalesPlatformProvider,
  parseSaleEventV1,
  saleEventNameOf,
} from "../../src/inbound-webhooks/providers/sales-platform-sale";

const receivedAt = new Date("2026-11-05T18:00:00.000Z");

function sale(patch: Record<string, unknown> = {}, event = "sale.paid") {
  return {
    event,
    sale: {
      id: "1234-20261105",
      paidAt: "2026-11-05T12:00:00-03:00",
      value: "400,00",
      phones: ["(48) 99999-0000", "(48) 3222-0000"],
      ...patch,
    },
  };
}

function parsed(payload: unknown) {
  const result = parseSimplesvetSaleEventV1(payload, { receivedAt });
  if (!result.ok) throw new Error(result.errorCode);
  return result.value;
}

describe("SimplesVet sale contract", () => {
  it("reads a paid sale as a Purchase in BRL", () => {
    expect(parsed(sale())).toMatchObject({
      provider: "simplesvet",
      automation: "purchase_paid",
      eventName: "Purchase",
      orderRef: "1234-20261105",
      valueCents: 40000,
      currency: "BRL",
      occurredAt: new Date("2026-11-05T15:00:00.000Z"),
    });
  });

  it("keeps every phone of the tutor as a candidate, with the 55 first", () => {
    const value = parsed(sale());
    expect(value.phone).toBe("5548999990000");
    expect(value.phoneCandidates).toEqual(
      expect.arrayContaining(["5548999990000", "554832220000"]),
    );
  });

  it("reads a Brasilia wall-clock time without an offset", () => {
    expect(
      parsed(sale({ paidAt: "2026-11-05 12:00:00" })).occurredAt,
    ).toEqual(new Date("2026-11-05T15:00:00.000Z"));
  });

  it("never sends an event after its arrival", () => {
    expect(
      parsed(sale({ paidAt: "2026-11-06T12:00:00-03:00" })).occurredAt,
    ).toEqual(receivedAt);
  });

  it("ignores any other event without judging the sale", () => {
    expect(parseSimplesvetSaleEventV1(sale({}, "sale.cancelled"))).toEqual({
      ok: false,
      errorCode: "simplesvet_sale_v1_status_not_supported",
      providerStatus: "sale.cancelled",
    });
    expect(parseSimplesvetAutomationV1(sale({}, "sale.cancelled"))).toEqual({
      ok: false,
      errorCode: "simplesvet_automation_v1_not_purchase",
    });
  });

  it.each([
    ["no value", { value: undefined }],
    ["zero value", { value: "0,00" }],
    ["currency text", { value: "R$ 400,00" }],
    ["no date", { paidAt: undefined }],
    ["unreadable date", { paidAt: "ontem" }],
    ["no phones", { phones: [] }],
    ["phones not a list", { phones: "48999990000" }],
  ])("refuses a sale with %s", (_name, patch) => {
    expect(parseSimplesvetSaleEventV1(sale(patch))).toMatchObject({
      ok: false,
      errorCode: "simplesvet_automation_v1_invalid_payload",
    });
  });

  it("refuses a sale without an identifier", () => {
    expect(parseSimplesvetSaleEventV1(sale({ id: " " }))).toEqual({
      ok: false,
      errorCode: "simplesvet_purchase_identity_missing",
    });
  });

  it("refuses a body that is not the contract", () => {
    for (const payload of [null, [], "x", { event: "sale.paid" }]) {
      expect(parseSimplesvetSaleEventV1(payload)).toMatchObject({
        ok: false,
        errorCode: "simplesvet_automation_v1_invalid_payload",
      });
    }
  });

  it("gives a resent sale the same purchase identity", () => {
    const identity = (payload: unknown) => {
      const value = parsed(payload);
      return buildProviderPurchaseIdentity({
        workspaceId: "ws_ficticio",
        provider: "simplesvet",
        accountRef: value.accountRef,
        orderRef: value.orderRef,
        eventName: value.eventName,
      });
    };
    expect(identity(sale())).toBe(identity(sale({ value: "401,00" })));
    expect(identity(sale())).not.toBe(identity(sale({ id: "1234-20261106" })));
  });

  it("is a sales platform of the single URL", () => {
    expect(isSalesPlatformProvider("simplesvet")).toBe(true);
    expect(saleEventNameOf("simplesvet", sale())).toBe("Purchase");
    expect(parseSaleEventV1("simplesvet", sale(), { receivedAt })).toMatchObject(
      { ok: true },
    );
    expect(
      parseSaleEventV1("simplesvet", sale({}, "sale.cancelled")),
    ).toMatchObject({ ok: false, kind: "status_not_supported" });
  });
});

describe("SimplesVet migrations", () => {
  const read = (name: string) =>
    readFileSync(
      resolve(__dirname, "../../prisma/migrations", name, "migration.sql"),
      "utf8",
    );
  const provider = read("20261105120000_simplesvet_provider");
  const release = read("20261105120100_simplesvet_parser_release");

  it("adds the enum values alone, so the release cannot hit P3009", () => {
    expect(provider).toContain(
      `ALTER TYPE "InboundWebhookProvider" ADD VALUE IF NOT EXISTS 'simplesvet'`,
    );
    expect(provider).toContain(
      `ALTER TYPE "DiagnosticSource" ADD VALUE IF NOT EXISTS 'simplesvet'`,
    );
    expect(provider).not.toMatch(/INSERT INTO|UPDATE\s+"/iu);
  });

  it("seeds a certified release without reviving a retired one", () => {
    expect(release).toMatch(/'simplesvet',\s*'automation-v1',\s*'certified'/u);
    expect(release).toContain(
      `WHERE "InboundWebhookParserRelease"."status" = 'observation_only'`,
    );
  });
});
