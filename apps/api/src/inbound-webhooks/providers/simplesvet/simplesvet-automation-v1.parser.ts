import { boundedString } from "../inbound-webhook-delivery-identity";
import {
  capAtReceived,
  type ParsedPaytAutomationV1,
  type PaytParseOptions,
  type PaytSaleEventName,
} from "../payt/payt-automation-v1.parser";
import { saoPauloTimestamp } from "../sao-paulo-timestamp";
import {
  yampiPhoneCandidates,
  yampiValueCents,
} from "../yampi/yampi-automation-v1.parser";

export type ParsedSimplesvetAutomationV1 = Omit<
  ParsedPaytAutomationV1,
  "provider"
> & {
  provider: "simplesvet";
};

export type SimplesvetSaleEventV1ParseResult =
  | { ok: true; value: ParsedSimplesvetAutomationV1 }
  | {
      ok: false;
      errorCode:
        | "simplesvet_sale_v1_status_not_supported"
        | "simplesvet_automation_v1_invalid_payload"
        | "simplesvet_purchase_identity_missing";
      providerStatus?: string | null;
    };

export type SimplesvetAutomationV1ParseResult =
  | { ok: true; value: ParsedSimplesvetAutomationV1 }
  | {
      ok: false;
      errorCode:
        | "simplesvet_automation_v1_not_purchase"
        | "simplesvet_automation_v1_invalid_payload"
        | "simplesvet_purchase_identity_missing";
    };

const SIMPLESVET_ACCOUNT_REF = "simplesvet";
const MAX_PHONES = 20;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function eventOf(record: Record<string, unknown> | null): string | null {
  return boundedString(record?.event, 60)?.trim().toLowerCase() || null;
}

export function simplesvetSaleEventNameOf(
  payload: unknown,
): PaytSaleEventName | null {
  return eventOf(asRecord(payload)) === "sale.paid" ? "Purchase" : null;
}

function phoneCandidatesOf(phones: unknown): string[] {
  if (!Array.isArray(phones)) return [];
  return [
    ...new Set(
      phones
        .slice(0, MAX_PHONES)
        .flatMap((phone) => yampiPhoneCandidates({ phone })),
    ),
  ];
}

export function parseSimplesvetSaleEventV1(
  payload: unknown,
  options: PaytParseOptions = {},
): SimplesvetSaleEventV1ParseResult {
  const record = asRecord(payload);
  const sale = asRecord(record?.sale);
  if (!record || !sale) {
    return {
      ok: false,
      errorCode: "simplesvet_automation_v1_invalid_payload",
    };
  }
  const providerStatus = eventOf(record);
  if (simplesvetSaleEventNameOf(record) !== "Purchase") {
    return {
      ok: false,
      errorCode: "simplesvet_sale_v1_status_not_supported",
      providerStatus,
    };
  }

  const orderRef = boundedString(sale.id, 255)?.trim();
  if (!orderRef || orderRef.includes("\0")) {
    return { ok: false, errorCode: "simplesvet_purchase_identity_missing" };
  }

  const valueCents = yampiValueCents(sale.value);
  const paidAt = saoPauloTimestamp(sale.paidAt);
  const phoneCandidates = phoneCandidatesOf(sale.phones);
  if (valueCents === null || !paidAt || phoneCandidates.length === 0) {
    return {
      ok: false,
      errorCode: "simplesvet_automation_v1_invalid_payload",
    };
  }

  return {
    ok: true,
    value: {
      provider: "simplesvet",
      automation: "purchase_paid",
      eventName: "Purchase",
      providerStatus,
      phone: phoneCandidates[0]!,
      phoneCandidates,
      occurredAt: capAtReceived(paidAt, options.receivedAt),
      externalExecutionKey: orderRef,
      orderRef,
      accountRef: SIMPLESVET_ACCOUNT_REF,
      valueCents,
      currency: "BRL",
      test: false,
      product: null,
      offer: null,
      productCodes: [],
    },
  };
}

export function parseSimplesvetAutomationV1(
  payload: unknown,
  options: PaytParseOptions = {},
): SimplesvetAutomationV1ParseResult {
  const parsed = parseSimplesvetSaleEventV1(payload, options);
  if (parsed.ok) return parsed;
  return parsed.errorCode === "simplesvet_sale_v1_status_not_supported"
    ? { ok: false, errorCode: "simplesvet_automation_v1_not_purchase" }
    : { ok: false, errorCode: parsed.errorCode };
}
