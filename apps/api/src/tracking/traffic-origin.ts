export type OriginChannel =
  | "google_ads"
  | "meta_ads"
  | "organic_search"
  | "organic_social"
  | "referral"
  | "other"
  | "direct";

export type OriginGroup = "paid" | "organic";
export type OriginConfidence = "confirmed" | "probable";

export type TouchEvent = {
  eventTime: Date;
  sessionId: string | null;
  environment: string;
  pageReferrerHost: string | null;
  attribution: unknown;
};

export type Touch = {
  channel: OriginChannel;
  group: OriginGroup;
  confidence: OriginConfidence | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  environment: string;
  at: Date;
};

const SESSION_GAP_MS = 30 * 60_000;
const TEST_REFERRERS = ["tagassistant.google.com", "eventsmanager.facebook.com"];
const OWN_DOMAIN = /(^|\.)comporvet\.com\.br$/;
const WHATSAPP_HOSTS = /(^|\.)(wa\.me|whatsapp\.com)$/;
const SEARCH_HOSTS = /(^|\.)(google\.[a-z.]+|bing\.com|yahoo\.com|search\.yahoo\.com|duckduckgo\.com|ecosia\.org|yandex\.[a-z.]+)$/;
const SOCIAL_HOSTS =
  /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|t\.co|x\.com|twitter\.com|linkedin\.com|lnkd\.in|youtube\.com|youtu\.be|tiktok\.com|pinterest\.[a-z.]+|threads\.net)$/;
const PAID_MEDIUM = /^(cpc|ppc|cpm|cpv|paid[_-]?\w*|display|ads?|paidsocial|paidsearch)$/;
const SOCIAL_MEDIUM = /^(social|social[_-]?\w*|organic[_-]?social|sm)$/;
const GOOGLE_SOURCE = /^(google|googleads|google_ads|adwords|youtube|gads)$/;
const META_SOURCE = /^(facebook|fb|instagram|ig|meta|an|msg|messenger|audience_network)$/;

function attributionValue(attribution: unknown, key: string): string | null {
  const value = (attribution as Record<string, unknown> | null)?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function lower(value: string | null): string | null {
  return value ? value.toLowerCase() : null;
}

export function isTestReferrer(host: string | null): boolean {
  return Boolean(host && TEST_REFERRERS.some((test) => host === test || host.endsWith(`.${test}`)));
}

function touch(
  channel: OriginChannel,
  confidence: OriginConfidence | null,
  event: TouchEvent,
  utm: { source: string | null; medium: string | null; campaign: string | null },
): Touch {
  return {
    channel,
    group: channel === "google_ads" || channel === "meta_ads" ? "paid" : "organic",
    confidence,
    source: utm.source,
    medium: utm.medium,
    campaign: utm.campaign,
    environment: event.environment,
    at: event.eventTime,
  };
}

/**
 * Classifies a session landing from its URL parameters and referrer only.
 * The fbp/fbc cookies are ignored on purpose: fbc lives 90 days, so a later
 * direct visit would otherwise look like a Meta ad click.
 */
export function classifyLanding(event: TouchEvent): Touch {
  const a = event.attribution;
  const source = lower(attributionValue(a, "utm_source"));
  const medium = lower(attributionValue(a, "utm_medium"));
  const campaign =
    attributionValue(a, "utm_campaign") ?? attributionValue(a, "utm_id") ?? attributionValue(a, "campaign_id");
  const utm = { source, medium, campaign };
  const referrer = lower(event.pageReferrerHost);
  const externalReferrer =
    referrer && !OWN_DOMAIN.test(referrer) && !WHATSAPP_HOSTS.test(referrer) ? referrer : null;

  if (["gclid", "gbraid", "wbraid", "dclid"].some((key) => attributionValue(a, key))) {
    return touch("google_ads", "confirmed", event, utm);
  }
  if (medium && PAID_MEDIUM.test(medium) && source) {
    if (GOOGLE_SOURCE.test(source)) return touch("google_ads", "confirmed", event, utm);
    if (META_SOURCE.test(source)) return touch("meta_ads", "confirmed", event, utm);
  }
  if (attributionValue(a, "fbclid")) return touch("meta_ads", "probable", event, utm);
  if (externalReferrer && SEARCH_HOSTS.test(externalReferrer) && !source) {
    return touch("organic_search", null, event, utm);
  }
  if ((medium && SOCIAL_MEDIUM.test(medium)) || (externalReferrer && SOCIAL_HOSTS.test(externalReferrer) && !source)) {
    return touch("organic_social", null, event, utm);
  }
  if (source || medium) {
    if (medium === "organic") return touch("organic_search", null, event, utm);
    return touch("other", null, event, utm);
  }
  if (externalReferrer) {
    if (SEARCH_HOSTS.test(externalReferrer)) return touch("organic_search", null, event, utm);
    if (SOCIAL_HOSTS.test(externalReferrer)) return touch("organic_social", null, event, utm);
    return touch("referral", null, event, utm);
  }
  return touch("direct", null, event, utm);
}

/**
 * One touch per browser session: the first event of each session_id (or of
 * each run of events less than 30 minutes apart when the session is unknown).
 * Sessions that came from Tag Assistant or Events Manager are test traffic.
 */
export function sessionTouches(events: TouchEvent[]): Touch[] {
  const sorted = [...events].sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime());
  const landings: TouchEvent[] = [];
  const seenSessions = new Set<string>();
  let lastAnonymousAt: number | null = null;
  for (const event of sorted) {
    if (event.sessionId) {
      if (seenSessions.has(event.sessionId)) continue;
      seenSessions.add(event.sessionId);
      landings.push(event);
      continue;
    }
    const at = event.eventTime.getTime();
    if (lastAnonymousAt === null || at - lastAnonymousAt > SESSION_GAP_MS) landings.push(event);
    lastAnonymousAt = at;
  }
  return landings.filter((event) => !isTestReferrer(lower(event.pageReferrerHost))).map(classifyLanding);
}

export type ResolvedOrigin = {
  first: Touch | null;
  lastNonDirect: Touch | null;
  visits: number;
};

export function resolveOrigin(events: TouchEvent[]): ResolvedOrigin {
  const touches = sessionTouches(events);
  const nonDirect = touches.filter((item) => item.channel !== "direct");
  return {
    first: touches[0] ?? null,
    lastNonDirect: nonDirect[nonDirect.length - 1] ?? touches[touches.length - 1] ?? null,
    visits: touches.length,
  };
}
