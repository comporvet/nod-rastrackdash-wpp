import { z } from "zod";

export const TRACKING_SCHEMA_VERSION = "1.0";
export const DEFAULT_ALLOWED_EVENTS = ["page_view", "scroll_depth", "click_whatsapp", "click"];
export const TRANSPORT_SOURCES = ["server", "web", "crm", "n8n", "whatsapp"] as const;
export type TransportSource = (typeof TRANSPORT_SOURCES)[number];

export const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
/** Opaque click reference: CV- plus 6 characters without look-alikes (no I, O, 0, 1). */
export const REF_TOKEN_PATTERN = /^CV-[A-HJ-NP-Z2-9]{6}$/;

const shortText = (max: number) => z.string().trim().min(1).max(max);
const consentState = z.enum(["granted", "denied", "unknown"]);

export const trackingEventPayloadSchema = z.object({
  schema_version: z.literal(TRACKING_SCHEMA_VERSION),
  event_name: z.string().regex(EVENT_NAME_PATTERN),
  event_id: shortText(128).optional(),
  event_time: z.union([z.number().int().positive(), z.string().datetime({ offset: true })]),
  page_location: z.string().max(2048).optional(),
  page_referrer: z.string().max(2048).optional(),
  client_id: shortText(128).optional(),
  session_id: shortText(64).optional(),
  modalidade: shortText(40).optional(),
  origem: shortText(40).optional(),
  ref_token: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(REF_TOKEN_PATTERN))
    .optional(),
  ip_address: shortText(64).optional(),
  user_agent: shortText(512).optional(),
  attribution: z.record(z.string().max(40), z.string().max(512)).optional(),
  consent: z
    .object({
      analytics_storage: consentState.optional(),
      ad_storage: consentState.optional(),
      ad_user_data: consentState.optional(),
      ad_personalization: consentState.optional(),
    })
    .optional(),
  properties: z
    .record(z.string().max(40), z.union([z.string().max(2048), z.number(), z.boolean()]))
    .optional(),
});

export type TrackingEventPayload = z.infer<typeof trackingEventPayloadSchema>;

export const connectionUpdateSchema = z.object({
  allowedEvents: z.array(z.string().regex(EVENT_NAME_PATTERN)).min(1).max(30).optional(),
  status: z.enum(["active", "paused"]).optional(),
  metaLeadEnabled: z.boolean().optional(),
  metaPixelId: z.union([z.string().trim().regex(/^\d{5,30}$/), z.literal("")]).optional(),
  metaTestEventCode: z.union([z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/), z.literal("")]).optional(),
});
