import { createHash } from "node:crypto";
import { classifyEnvironment, type Ga4Environment } from "../google-analytics/ga4-environments";
import type { TrackingEventPayload } from "./tracking-event.schema";

export const URL_ATTRIBUTION_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "fbclid",
] as const;

const PAYLOAD_ATTRIBUTION_KEYS = new Set<string>([
  ...URL_ATTRIBUTION_PARAMS,
  "fbp",
  "fbc",
  "ctwa_clid",
  "campaign_id",
  "adset_id",
  "ad_id",
  "placement",
]);

const NUMERIC_PROPERTIES = new Set(["percent_scrolled", "engagement_time_msec"]);
const BOOLEAN_PROPERTIES = new Set(["outbound"]);
const URL_PROPERTIES = new Set(["link_url"]);
const TEXT_PROPERTIES = new Set(["link_domain", "link_text", "page_title"]);

export type NormalizedTrackingEvent = {
  schemaVersion: string;
  eventName: string;
  eventId: string | null;
  dedupeKey: string;
  dedupeConfidence: "event_id" | "derived";
  eventTime: Date;
  environment: string;
  hostname: string | null;
  pagePath: string | null;
  pageLocation: string | null;
  pageReferrerHost: string | null;
  clientId: string | null;
  sessionId: string | null;
  modalidade: string | null;
  origem: string | null;
  refToken: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  attribution: Record<string, string>;
  consent: Record<string, string>;
  properties: Record<string, string | number | boolean>;
};

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Origin and path plus only the allowlisted attribution parameters: other query values may carry personal data. */
export function sanitizePageLocation(url: URL): string {
  const kept = new URLSearchParams();
  for (const key of URL_ATTRIBUTION_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) kept.set(key, value.slice(0, 512));
  }
  const query = kept.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}

export function eventTimeOf(value: number | string): Date {
  return new Date(typeof value === "number" ? value : Date.parse(value));
}

export function normalizeTrackingEvent(
  payload: TrackingEventPayload,
  environments: Ga4Environment[],
): NormalizedTrackingEvent {
  const page = parseUrl(payload.page_location);
  const referrer = parseUrl(payload.page_referrer);
  const hostname = page?.hostname.toLowerCase() ?? null;
  const pagePath = page?.pathname ?? null;
  const pageLocation = page ? sanitizePageLocation(page) : null;
  const eventTime = eventTimeOf(payload.event_time);

  const attribution: Record<string, string> = {};
  if (page) {
    for (const key of URL_ATTRIBUTION_PARAMS) {
      const value = page.searchParams.get(key)?.trim();
      if (value) attribution[key] = value.slice(0, 512);
    }
  }
  for (const [key, value] of Object.entries(payload.attribution ?? {})) {
    const trimmed = value.trim();
    if (PAYLOAD_ATTRIBUTION_KEYS.has(key) && trimmed) attribution[key] = trimmed;
  }

  const consent: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload.consent ?? {})) {
    if (value) consent[key] = value;
  }

  const properties: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(payload.properties ?? {})) {
    if (NUMERIC_PROPERTIES.has(key)) {
      const number = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(number)) properties[key] = number;
    } else if (BOOLEAN_PROPERTIES.has(key)) {
      if (typeof value === "boolean") properties[key] = value;
      else if (value === "true" || value === "false") properties[key] = value === "true";
    } else if (URL_PROPERTIES.has(key) && typeof value === "string") {
      const url = parseUrl(value);
      if (url) properties[key] = `${url.origin}${url.pathname}`;
    } else if (TEXT_PROPERTIES.has(key) && typeof value === "string" && value.trim()) {
      properties[key] = value.trim().slice(0, 200);
    }
  }

  const environment =
    hostname && pagePath ? classifyEnvironment(environments, hostname, pagePath) ?? "unknown" : "unknown";
  const eventId = payload.event_id ?? null;
  const sessionId = payload.session_id ?? null;
  const clientId = payload.client_id ?? null;

  return {
    schemaVersion: payload.schema_version,
    eventName: payload.event_name,
    eventId,
    ...dedupeIdentity(payload.event_name, eventId, {
      clientId,
      sessionId,
      eventTime,
      pageLocation,
    }),
    eventTime,
    environment,
    hostname,
    pagePath,
    pageLocation,
    pageReferrerHost: referrer?.hostname.toLowerCase() ?? null,
    clientId,
    sessionId,
    modalidade: payload.modalidade ?? null,
    origem: payload.origem ?? null,
    refToken: payload.ref_token ?? null,
    ipAddress: payload.ip_address ?? null,
    userAgent: payload.user_agent ?? null,
    attribution,
    consent,
    properties,
  };
}

/**
 * The shared event_id is the only reliable key. Without it the fallback is
 * exact (same client, session, millisecond and page), so distinct real
 * interactions are never merged; it is flagged as lower confidence.
 */
export function dedupeIdentity(
  eventName: string,
  eventId: string | null,
  context: { clientId: string | null; sessionId: string | null; eventTime: Date; pageLocation: string | null },
): { dedupeKey: string; dedupeConfidence: "event_id" | "derived" } {
  if (eventId) {
    return { dedupeKey: `id:${eventName}:${eventId}`, dedupeConfidence: "event_id" };
  }
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        eventName,
        context.clientId ?? "",
        context.sessionId ?? "",
        context.eventTime.getTime(),
        context.pageLocation ?? "",
      ]),
    )
    .digest("hex");
  return { dedupeKey: `derived:${digest}`, dedupeConfidence: "derived" };
}
