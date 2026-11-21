import type { Ga4FunnelResponse, Ga4ReportResponse } from "./ga4.client";
import {
  andFilters,
  environmentFilters,
  exactFilter,
  inListFilter,
  type Ga4Environment,
  type Ga4FilterExpression,
} from "./ga4-environments";

export const EVENT_PAGE_VIEW = "page_view";
export const EVENT_WHATSAPP = "click_whatsapp";
export const EVENT_SCROLL = "scroll_depth";
export const SCROLL_PERCENT_DIMENSION = "customEvent:scroll_percent";
export const MODALIDADE_DIMENSION = "customEvent:modalidade";
export const SCROLL_MILESTONES = [10, 25, 50, 75, 90, 100] as const;

export const totalsMetrics = [
  "totalUsers",
  "activeUsers",
  "sessions",
  "screenPageViews",
  "engagedSessions",
  "engagementRate",
  "userEngagementDuration",
] as const;

const acquisitionMetrics = ["sessions", "activeUsers", "engagedSessions", "screenPageViews"] as const;

export const acquisitionDimensions = {
  sourceMedium: "sessionSourceMedium",
  channel: "sessionDefaultChannelGroup",
  campaign: "sessionCampaignName",
  device: "deviceCategory",
} as const;

export type Ga4DateRange = { since: string; until: string };

export type Ga4QueryFilters = {
  current: Ga4DateRange;
  previous: Ga4DateRange | null;
  device?: string;
  sourceMedium?: string;
  campaign?: string;
};

export type ParsedRow = { dimensions: Record<string, string>; metrics: Record<string, number> };

export function parseReport(report: Ga4ReportResponse | undefined): ParsedRow[] {
  const dimensionNames = report?.dimensionHeaders?.map((header) => header.name) ?? [];
  const metricNames = report?.metricHeaders?.map((header) => header.name) ?? [];
  return (report?.rows ?? []).map((row) => ({
    dimensions: Object.fromEntries(
      dimensionNames.map((name, index) => [name, row.dimensionValues?.[index]?.value ?? ""]),
    ),
    metrics: Object.fromEntries(
      metricNames.map((name, index) => [name, Number(row.metricValues?.[index]?.value ?? 0)]),
    ),
  }));
}

function dateRanges(filters: Ga4QueryFilters, withPrevious: boolean) {
  const ranges = [{ startDate: filters.current.since, endDate: filters.current.until, name: "current" }];
  if (withPrevious && filters.previous) {
    ranges.push({ startDate: filters.previous.since, endDate: filters.previous.until, name: "previous" });
  }
  return ranges;
}

export function scopeFilters(environment: Ga4Environment, filters: Ga4QueryFilters): Ga4FilterExpression[] {
  const scope = environmentFilters(environment);
  if (filters.device) scope.push(exactFilter("deviceCategory", filters.device));
  if (filters.sourceMedium) scope.push(exactFilter("sessionSourceMedium", filters.sourceMedium));
  if (filters.campaign) scope.push(exactFilter("sessionCampaignName", filters.campaign));
  return scope;
}

function withEvent(scope: Ga4FilterExpression[], event: Ga4FilterExpression) {
  return andFilters([...scope, event]);
}

export function buildCoreRequests(
  environment: Ga4Environment,
  filters: Ga4QueryFilters,
  options: { scrollDimensionAvailable: boolean },
) {
  const scope = scopeFilters(environment, filters);
  const requests: Record<string, unknown> = {
    totals: {
      dateRanges: dateRanges(filters, true),
      metrics: totalsMetrics.map((name) => ({ name })),
      dimensionFilter: andFilters(scope),
    },
    events: {
      dateRanges: dateRanges(filters, true),
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: withEvent(scope, inListFilter("eventName", [EVENT_PAGE_VIEW, EVENT_WHATSAPP, EVENT_SCROLL])),
    },
    daily: {
      dateRanges: dateRanges(filters, false),
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "screenPageViews" }, { name: "totalUsers" }],
      dimensionFilter: andFilters(scope),
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 1000,
      keepEmptyRows: true,
    },
    dailyWhatsapp: {
      dateRanges: dateRanges(filters, false),
      dimensions: [{ name: "date" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: withEvent(scope, exactFilter("eventName", EVENT_WHATSAPP)),
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 1000,
    },
  };
  if (options.scrollDimensionAvailable) {
    requests.scroll = {
      dateRanges: dateRanges(filters, false),
      dimensions: [{ name: SCROLL_PERCENT_DIMENSION }, { name: "unifiedPagePathScreen" }],
      metrics: [{ name: "totalUsers" }, { name: "eventCount" }],
      dimensionFilter: withEvent(scope, exactFilter("eventName", EVENT_SCROLL)),
      limit: 500,
    };
  }
  return requests;
}

export function buildAcquisitionRequests(environment: Ga4Environment, filters: Ga4QueryFilters) {
  const scope = scopeFilters(environment, filters);
  return Object.fromEntries(
    Object.entries(acquisitionDimensions).map(([key, dimension]) => [
      key,
      {
        dateRanges: dateRanges(filters, false),
        dimensions: [{ name: dimension }],
        metrics: acquisitionMetrics.map((name) => ({ name })),
        dimensionFilter: andFilters(scope),
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 50,
      },
    ]),
  );
}

function unanchored(pattern: string) {
  return pattern.replace(/^\^/, "").replace(/\$$/, "");
}

/**
 * Funnel steps reject hostName/pagePath ("not supported inside segments &
 * funnel steps"), so the environment is matched on the page_location event
 * parameter, the same field the GA4 explorations filter on.
 */
export function pageLocationPattern(environment: Ga4Environment) {
  const path = environment.pathPattern ? unanchored(environment.pathPattern) : "(/[^?#]*)?";
  return `^https?://(?:${unanchored(environment.hostPattern)})(?:${path})([?#].*)?$`;
}

export const FUNNEL_PAGE_STRATEGIES = [
  "param_page_location",
  "field_pageLocation",
  "field_hostName",
  "none",
] as const;

export type FunnelPageStrategy = (typeof FUNNEL_PAGE_STRATEGIES)[number];

function funnelStepFilter(environment: Ga4Environment, eventName: string, strategy: FunnelPageStrategy) {
  const event = { funnelEventFilter: { eventName } };
  if (strategy === "none") return event;
  if (strategy === "param_page_location") {
    return {
      funnelEventFilter: {
        eventName,
        funnelParameterFilterExpression: {
          funnelParameterFilter: {
            eventParameterName: "page_location",
            stringFilter: { matchType: "FULL_REGEXP", value: pageLocationPattern(environment) },
          },
        },
      },
    };
  }
  const field =
    strategy === "field_pageLocation"
      ? { fieldName: "pageLocation", value: pageLocationPattern(environment) }
      : { fieldName: "hostName", value: environment.hostPattern };
  return {
    andGroup: {
      expressions: [
        event,
        { funnelFieldFilter: { fieldName: field.fieldName, stringFilter: { matchType: "FULL_REGEXP", value: field.value } } },
      ],
    },
  };
}

export const FUNNEL_STEP_NAMES = ["Visualização", "Clique no WhatsApp"] as const;

export function buildFunnelRequest(
  environment: Ga4Environment,
  filters: Ga4QueryFilters,
  range: Ga4DateRange,
  options: { strategy?: FunnelPageStrategy; breakdown?: boolean } = {},
) {
  const strategy = options.strategy ?? "param_page_location";
  const extra: Ga4FilterExpression[] = [];
  if (filters.device) extra.push(exactFilter("deviceCategory", filters.device));
  if (filters.sourceMedium) extra.push(exactFilter("sessionSourceMedium", filters.sourceMedium));
  if (filters.campaign) extra.push(exactFilter("sessionCampaignName", filters.campaign));
  return {
    dateRanges: [{ startDate: range.since, endDate: range.until }],
    funnel: {
      isOpenFunnel: false,
      steps: [
        { name: FUNNEL_STEP_NAMES[0], filterExpression: funnelStepFilter(environment, EVENT_PAGE_VIEW, strategy) },
        {
          name: FUNNEL_STEP_NAMES[1],
          isDirectlyFollowedBy: false,
          filterExpression: funnelStepFilter(environment, EVENT_WHATSAPP, strategy),
        },
      ],
    },
    ...(options.breakdown === false ? {} : { funnelBreakdown: { breakdownDimension: { name: "deviceCategory" } } }),
    ...(extra.length ? { dimensionFilter: andFilters(extra) } : {}),
  };
}

export type FunnelStep = {
  name: string;
  activeUsers: number;
  completionRate: number | null;
  abandonments: number | null;
  abandonmentRate: number | null;
};

export type FunnelResult = {
  steps: FunnelStep[];
  progressionRate: number | null;
  byDevice: { device: string; steps: FunnelStep[]; progressionRate: number | null }[];
};

const TOTAL_BREAKDOWN = "RESERVED_TOTAL";

export function progressionRate(steps: FunnelStep[]): number | null {
  const first = steps[0]?.activeUsers ?? 0;
  const second = steps[1]?.activeUsers ?? 0;
  return first > 0 ? (second / first) * 100 : null;
}

function stepIndex(stepName: string): number {
  const match = /^(\d+)\./.exec(stepName);
  if (match) return Number(match[1]) - 1;
  return FUNNEL_STEP_NAMES.findIndex((name) => stepName.includes(name));
}

function emptySteps(): FunnelStep[] {
  return FUNNEL_STEP_NAMES.map((name) => ({
    name,
    activeUsers: 0,
    completionRate: null,
    abandonments: null,
    abandonmentRate: null,
  }));
}

export function parseFunnel(response: Ga4FunnelResponse): FunnelResult {
  const rows = parseReport(response.funnelTable);
  const totals = emptySteps();
  const devices = new Map<string, FunnelStep[]>();
  for (const row of rows) {
    const index = stepIndex(row.dimensions.funnelStepName ?? "");
    if (index < 0 || index >= FUNNEL_STEP_NAMES.length) continue;
    const breakdown = row.dimensions.deviceCategory ?? TOTAL_BREAKDOWN;
    const target =
      breakdown === TOTAL_BREAKDOWN
        ? totals
        : devices.get(breakdown) ?? devices.set(breakdown, emptySteps()).get(breakdown)!;
    target[index] = {
      name: FUNNEL_STEP_NAMES[index],
      activeUsers: row.metrics.activeUsers ?? 0,
      completionRate: row.metrics.funnelStepCompletionRate ?? null,
      abandonments: row.metrics.funnelStepAbandonments ?? null,
      abandonmentRate: row.metrics.funnelStepAbandonmentRate ?? null,
    };
  }
  return {
    steps: totals,
    progressionRate: progressionRate(totals),
    byDevice: [...devices.entries()].map(([device, steps]) => ({
      device,
      steps,
      progressionRate: progressionRate(steps),
    })),
  };
}

export function previousPeriod(range: Ga4DateRange): Ga4DateRange {
  const day = 86_400_000;
  const start = Date.parse(`${range.since}T00:00:00Z`);
  const end = Date.parse(`${range.until}T00:00:00Z`);
  const length = Math.round((end - start) / day) + 1;
  const format = (time: number) => new Date(time).toISOString().slice(0, 10);
  return { since: format(start - length * day), until: format(start - day) };
}
