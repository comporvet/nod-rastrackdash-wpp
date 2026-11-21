import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import {
  RUNTIME_ENV,
  RUNTIME_FETCH,
  type RuntimeEnv,
  type RuntimeFetch,
} from "../common/runtime/runtime.module";
import {
  Ga4CredentialUnavailableError,
  decryptServiceAccountKey,
  encryptServiceAccountKey,
  parseServiceAccountKey,
} from "./ga4-credential";
import { Ga4ApiError, Ga4Client, type Ga4ErrorKind, type Ga4ReportResponse } from "./ga4.client";
import { comporvetEnvironmentPreset, ga4EnvironmentsSchema, type Ga4Environment } from "./ga4-environments";
import {
  EVENT_PAGE_VIEW,
  EVENT_SCROLL,
  EVENT_WHATSAPP,
  FUNNEL_PAGE_STRATEGIES,
  MODALIDADE_DIMENSION,
  SCROLL_MILESTONES,
  SCROLL_PERCENT_DIMENSION,
  buildAcquisitionRequests,
  buildCoreRequests,
  buildFunnelRequest,
  pageLocationPattern,
  parseFunnel,
  parseReport,
  previousPeriod,
  progressionRate,
  totalsMetrics,
  type FunnelResult,
  type Ga4QueryFilters,
  type ParsedRow,
} from "./ga4-report";

const CACHE_TTL_MS = 10 * 60_000;
const METADATA_TTL_MS = 60 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 400;

export type SectionStatus =
  | "ok"
  | "no_data"
  | "incomplete_config"
  | "unauthorized"
  | "quota"
  | "temporary_error"
  | "invalid_request";

type Section<T> = { status: SectionStatus; message?: string; data: T | null };

type ConnectionRow = {
  id: string;
  workspaceId: string;
  propertyId: string;
  serviceAccountEmail: string;
  credentialEncrypted: string;
  credentialIv: string;
  credentialTag: string;
  environments?: unknown;
  expectedMeasurementIds: string[];
  lastValidatedAt: Date | null;
  lastErrorKind: string | null;
  lastErrorMessage: string | null;
  updatedAt: Date;
};

export type Ga4ConnectionInput = {
  propertyId: string;
  serviceAccountJson?: string;
  environments?: unknown;
  expectedMeasurementIds: string[];
};

export type Ga4ReportQuery = {
  since?: string;
  until?: string;
  compare?: boolean;
  device?: string;
  sourceMedium?: string;
  campaign?: string;
  refresh?: boolean;
};

function statusFromError(kind: Ga4ErrorKind): SectionStatus {
  if (kind === "unauthorized") return "unauthorized";
  if (kind === "quota") return "quota";
  if (kind === "temporary") return "temporary_error";
  return "invalid_request";
}

function failed<T>(error: unknown): Section<T> {
  if (error instanceof Ga4ApiError) {
    return { status: statusFromError(error.kind), message: error.message, data: null };
  }
  return { status: "temporary_error", message: "Falha inesperada ao montar a seção", data: null };
}

function rangeFilter(rows: ParsedRow[], name: "current" | "previous") {
  return rows.filter((row) => (row.dimensions.dateRange ?? "current") === name);
}

function totalsFrom(rows: ParsedRow[]) {
  const row = rows[0];
  const totals = Object.fromEntries(totalsMetrics.map((name) => [name, row?.metrics[name] ?? 0])) as Record<
    (typeof totalsMetrics)[number],
    number
  >;
  // The Data API has no per-session engagement average; derive it from the total duration.
  return {
    ...totals,
    averageEngagementTimePerSession: totals.sessions > 0 ? totals.userEngagementDuration / totals.sessions : 0,
  };
}

function eventsFrom(rows: ParsedRow[]) {
  const events = Object.fromEntries(
    [EVENT_PAGE_VIEW, EVENT_WHATSAPP, EVENT_SCROLL].map((name) => [name, { eventCount: 0, totalUsers: 0 }]),
  );
  for (const row of rows) {
    const name = row.dimensions.eventName;
    if (name && events[name]) {
      events[name] = { eventCount: row.metrics.eventCount ?? 0, totalUsers: row.metrics.totalUsers ?? 0 };
    }
  }
  return events as Record<string, { eventCount: number; totalUsers: number }>;
}

function isoDate(ga4Date: string) {
  return `${ga4Date.slice(0, 4)}-${ga4Date.slice(4, 6)}-${ga4Date.slice(6, 8)}`;
}

function eachDay(since: string, until: string): string[] {
  const days: string[] = [];
  for (let time = Date.parse(`${since}T00:00:00Z`); time <= Date.parse(`${until}T00:00:00Z`); time += 86_400_000) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
}

@Injectable()
export class GoogleAnalyticsService {
  private readonly logger = new Logger(GoogleAnalyticsService.name);
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();
  private readonly clients = new Map<string, { updatedAt: number; client: Ga4Client }>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RUNTIME_ENV) private readonly env: RuntimeEnv,
    @Inject(RUNTIME_FETCH) private readonly fetchFn: RuntimeFetch,
  ) {}

  async getConnection(workspaceId: string) {
    const row = (await this.prisma.googleAnalyticsConnection.findUnique({ where: { workspaceId } })) as ConnectionRow | null;
    if (!row) {
      return { configured: false as const, environmentPreset: comporvetEnvironmentPreset };
    }
    return {
      configured: true as const,
      propertyId: row.propertyId,
      serviceAccountEmail: row.serviceAccountEmail,
      environments: this.environmentsOf(row),
      expectedMeasurementIds: row.expectedMeasurementIds,
      lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
      lastErrorKind: row.lastErrorKind,
      lastErrorMessage: row.lastErrorMessage,
      environmentPreset: comporvetEnvironmentPreset,
    };
  }

  async saveConnection(workspaceId: string, userId: string, input: Ga4ConnectionInput) {
    const propertyId = input.propertyId.trim().replace(/^properties\//, "");
    if (!/^\d{3,20}$/.test(propertyId)) {
      throw new BadRequestException("O ID da propriedade GA4 é numérico (não é o G-...)");
    }
    const environments = ga4EnvironmentsSchema.safeParse(input.environments);
    if (!environments.success) {
      throw new BadRequestException(`Ambientes inválidos: ${environments.error.issues[0]?.message ?? ""}`);
    }
    const measurementIds = input.expectedMeasurementIds
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    if (measurementIds.some((value) => !/^G-[A-Z0-9]{4,20}$/.test(value))) {
      throw new BadRequestException("IDs de medição devem ter o formato G-XXXXXXX");
    }

    const existing = await this.prisma.googleAnalyticsConnection.findUnique({ where: { workspaceId } });
    let credential: { serviceAccountEmail: string; credentialEncrypted: string; credentialIv: string; credentialTag: string } | null =
      null;
    if (input.serviceAccountJson?.trim()) {
      const key = parseServiceAccountKey(input.serviceAccountJson);
      if (!key) throw new BadRequestException("Chave JSON da conta de serviço inválida");
      try {
        credential = { serviceAccountEmail: key.client_email, ...encryptServiceAccountKey(this.env, workspaceId, key) };
      } catch (error) {
        if (error instanceof Ga4CredentialUnavailableError) {
          throw new BadRequestException(
            "A API precisa de INBOUND_WEBHOOK_ENCRYPTION_KEY e INBOUND_WEBHOOKS_ENABLED=true para guardar a chave",
          );
        }
        throw error;
      }
    } else if (!existing) {
      throw new BadRequestException("Envie a chave JSON da conta de serviço");
    }

    const data = {
      propertyId,
      environments: environments.data,
      expectedMeasurementIds: measurementIds,
      lastErrorKind: null,
      lastErrorMessage: null,
      ...(credential ?? {}),
    };
    if (existing) {
      await this.prisma.googleAnalyticsConnection.update({ where: { workspaceId }, data });
    } else {
      await this.prisma.googleAnalyticsConnection.create({
        data: { ...data, ...credential!, workspaceId, createdByUserId: userId },
      });
    }
    this.invalidate(workspaceId);
    return this.getConnection(workspaceId);
  }

  async deleteConnection(workspaceId: string) {
    await this.prisma.googleAnalyticsConnection.deleteMany({ where: { workspaceId } });
    this.invalidate(workspaceId);
    return { configured: false };
  }

  async discover(workspaceId: string) {
    const row = await this.requireConnection(workspaceId);
    const client = this.clientFor(row);
    const result: Record<string, unknown> = { serviceAccountEmail: row.serviceAccountEmail, propertyId: row.propertyId };

    const accessible = await this.section(async () => {
      const summaries = await client.listAccountSummaries();
      return (summaries.accountSummaries ?? []).flatMap((account) =>
        (account.propertySummaries ?? []).map((property) => ({
          account: account.displayName,
          propertyId: property.property.replace(/^properties\//, ""),
          propertyName: property.displayName,
        })),
      );
    });
    result.accessibleProperties = accessible;

    result.property = await this.section(async () => {
      const property = await client.getProperty(row.propertyId);
      return { displayName: property.displayName, timeZone: property.timeZone ?? null, currencyCode: property.currencyCode ?? null };
    });

    result.dataStreams = await this.section(async () => {
      const streams = await client.listDataStreams(row.propertyId);
      const items = (streams.dataStreams ?? []).map((stream) => ({
        streamId: stream.name.split("/").pop() ?? stream.name,
        type: stream.type,
        displayName: stream.displayName,
        measurementId: stream.webStreamData?.measurementId ?? null,
        defaultUri: stream.webStreamData?.defaultUri ?? null,
      }));
      const found = new Set(items.map((item) => item.measurementId));
      return {
        items,
        expected: row.expectedMeasurementIds.map((id) => ({ measurementId: id, foundInProperty: found.has(id) })),
      };
    });

    result.customDimensions = await this.section(async () => {
      const names = await this.metadataDimensions(row, client, true);
      return [SCROLL_PERCENT_DIMENSION, MODALIDADE_DIMENSION].map((apiName) => ({ apiName, available: names.has(apiName) }));
    });

    const property = result.property as Section<unknown>;
    await this.prisma.googleAnalyticsConnection.update({
      where: { workspaceId },
      data:
        property.status === "ok"
          ? { lastValidatedAt: new Date(), lastErrorKind: null, lastErrorMessage: null }
          : { lastErrorKind: property.status, lastErrorMessage: property.message?.slice(0, 500) ?? null },
    });
    return result;
  }

  /**
   * Runs the same two-step funnel with each way of scoping it to the page, so
   * a zeroed funnel can be traced to the filter. Returns the raw funnel table
   * (headers and first rows), never credentials.
   */
  async funnelDiagnostics(workspaceId: string, query: Ga4ReportQuery) {
    const row = await this.requireConnection(workspaceId);
    const client = this.clientFor(row);
    const filters = this.parseFilters({ since: query.since, until: query.until });
    const variants = [
      ...FUNNEL_PAGE_STRATEGIES.map((strategy) => ({ strategy, breakdown: false })),
      { strategy: "param_page_location" as const, breakdown: true },
    ];
    const environments = await Promise.all(
      this.environmentsOf(row).map(async (environment) => ({
        key: environment.key,
        label: environment.label,
        pageLocationPattern: pageLocationPattern(environment),
        variants: await Promise.all(
          variants.map(async (variant) => {
            const request = buildFunnelRequest(environment, filters, filters.current, variant);
            try {
              const response = await client.runFunnelReport(row.propertyId, request);
              const parsed = parseFunnel(response);
              return {
                ...variant,
                status: "ok" as SectionStatus,
                steps: parsed.steps.map((step) => step.activeUsers),
                raw: {
                  dimensionHeaders: response.funnelTable?.dimensionHeaders ?? [],
                  metricHeaders: response.funnelTable?.metricHeaders ?? [],
                  rows: (response.funnelTable?.rows ?? []).slice(0, 8),
                  rowCount: response.funnelTable?.rowCount ?? null,
                },
                stepsRequest: request.funnel.steps,
              };
            } catch (error) {
              const section = failed(error);
              return { ...variant, status: section.status, message: section.message, steps: null, raw: null, stepsRequest: request.funnel.steps };
            }
          }),
        ),
      })),
    );
    return { propertyId: row.propertyId, range: filters.current, environments };
  }

  async report(workspaceId: string, query: Ga4ReportQuery) {
    const row = (await this.prisma.googleAnalyticsConnection.findUnique({ where: { workspaceId } })) as ConnectionRow | null;
    if (!row) {
      return { status: "incomplete_config" as SectionStatus, message: "GA4 ainda não configurado neste workspace" };
    }
    const filters = this.parseFilters(query);
    const cacheKey = JSON.stringify([workspaceId, row.updatedAt.getTime(), filters]);
    if (!query.refresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
    }

    const client = this.clientFor(row);
    const environments = this.environmentsOf(row);
    let dimensions: Set<string>;
    try {
      dimensions = await this.metadataDimensions(row, client, Boolean(query.refresh));
    } catch (error) {
      const section = failed(error);
      await this.recordError(workspaceId, error);
      return { status: section.status, message: section.message, propertyId: row.propertyId };
    }
    const scrollDimensionAvailable = dimensions.has(SCROLL_PERCENT_DIMENSION);

    const reports = await Promise.all(
      environments.map((environment) => this.environmentReport(client, row.propertyId, environment, filters, scrollDimensionAvailable)),
    );

    const value = {
      status: "ok" as SectionStatus,
      propertyId: row.propertyId,
      generatedAt: new Date().toISOString(),
      filters,
      customDimensions: {
        [SCROLL_PERCENT_DIMENSION]: scrollDimensionAvailable,
        [MODALIDADE_DIMENSION]: dimensions.has(MODALIDADE_DIMENSION),
      },
      environments: reports,
    };
    const allUnauthorized = reports.every((report) => report.core.status === "unauthorized");
    if (allUnauthorized) {
      await this.recordError(workspaceId, new Ga4ApiError("unauthorized", 403, reports[0]?.core.message ?? ""));
    } else {
      this.remember(cacheKey, value, CACHE_TTL_MS);
    }
    return value;
  }

  private async environmentReport(
    client: Ga4Client,
    propertyId: string,
    environment: Ga4Environment,
    filters: Ga4QueryFilters,
    scrollDimensionAvailable: boolean,
  ) {
    const coreRequests = buildCoreRequests(environment, filters, { scrollDimensionAvailable });
    const coreKeys = Object.keys(coreRequests);
    const acquisitionRequests = buildAcquisitionRequests(environment, filters);
    const acquisitionKeys = Object.keys(acquisitionRequests);

    const [coreBatch, acquisitionBatch, funnel, previousFunnel] = await Promise.all([
      this.batch(client, propertyId, coreKeys, Object.values(coreRequests)),
      this.batch(client, propertyId, acquisitionKeys, Object.values(acquisitionRequests)),
      this.funnel(client, propertyId, environment, filters, filters.current),
      filters.previous
        ? this.funnel(client, propertyId, environment, filters, filters.previous)
        : Promise.resolve(null),
    ]);

    const core = this.mapSection(coreBatch, (reports) => {
      const totals = parseReport(reports.totals);
      const events = parseReport(reports.events);
      const dailyRows = new Map(parseReport(reports.daily).map((item) => [isoDate(item.dimensions.date ?? ""), item.metrics]));
      const clickRows = new Map(
        parseReport(reports.dailyWhatsapp).map((item) => [isoDate(item.dimensions.date ?? ""), item.metrics]),
      );
      const daily = eachDay(filters.current.since, filters.current.until).map((date) => ({
        date,
        sessions: dailyRows.get(date)?.sessions ?? 0,
        screenPageViews: dailyRows.get(date)?.screenPageViews ?? 0,
        totalUsers: dailyRows.get(date)?.totalUsers ?? 0,
        whatsappClicks: clickRows.get(date)?.eventCount ?? 0,
      }));
      const current = totalsFrom(rangeFilter(totals, "current"));
      return {
        totals: {
          current,
          previous: filters.previous ? totalsFrom(rangeFilter(totals, "previous")) : null,
        },
        events: {
          current: eventsFrom(rangeFilter(events, "current")),
          previous: filters.previous ? eventsFrom(rangeFilter(events, "previous")) : null,
        },
        daily,
        hasData: current.screenPageViews > 0 || current.sessions > 0,
      };
    });

    const scroll: Section<unknown> = !scrollDimensionAvailable
      ? {
          status: "incomplete_config",
          message: `${SCROLL_PERCENT_DIMENSION} não aparece nos metadados da propriedade`,
          data: null,
        }
      : this.mapSection(coreBatch, (reports) => {
          const rows = parseReport(reports.scroll);
          const byPage = rows.map((item) => ({
            pagePath: item.dimensions.unifiedPagePathScreen ?? "",
            percent: Number(item.dimensions[SCROLL_PERCENT_DIMENSION]),
            totalUsers: item.metrics.totalUsers ?? 0,
            eventCount: item.metrics.eventCount ?? 0,
          }));
          const milestones = SCROLL_MILESTONES.map((percent) => {
            const matching = byPage.filter((item) => item.percent === percent);
            return {
              percent,
              eventCount: matching.reduce((sum, item) => sum + item.eventCount, 0),
              pages: matching.length,
            };
          });
          const otherValues = [...new Set(byPage.map((item) => item.percent))].filter(
            (percent) => !SCROLL_MILESTONES.includes(percent as (typeof SCROLL_MILESTONES)[number]),
          );
          return { byPage, milestones, otherValues };
        });

    const acquisition = this.mapSection(acquisitionBatch, (reports) =>
      Object.fromEntries(
        acquisitionKeys.map((key) => [
          key,
          parseReport(reports[key]).map((item) => ({
            value: Object.values(item.dimensions)[0] ?? "",
            ...item.metrics,
          })),
        ]),
      ),
    );

    const scrollUsers = await this.scrollUsers(client, propertyId, environment, filters, scrollDimensionAvailable);

    return {
      key: environment.key,
      label: environment.label,
      definition: environment,
      core: this.withEmptyStatus(core),
      scroll,
      scrollUsers,
      acquisition,
      funnel: this.funnelSection(funnel, core),
      previousFunnel: previousFunnel ? this.funnelSection(previousFunnel, core, "previous") : null,
    };
  }

  /**
   * Usuários únicos que alcançaram cada marco. Uma consulta por marco, sem a
   * dimensão de página: somar usuários de linhas diferentes contaria a mesma
   * pessoa mais de uma vez.
   */
  private async scrollUsers(
    client: Ga4Client,
    propertyId: string,
    environment: Ga4Environment,
    filters: Ga4QueryFilters,
    available: boolean,
  ): Promise<Section<{ percent: number; totalUsers: number }[]>> {
    if (!available) return { status: "incomplete_config", data: null };
    const requests = buildCoreRequests(environment, filters, { scrollDimensionAvailable: true }).scroll as {
      dimensionFilter: unknown;
      dateRanges: unknown;
    };
    const request = {
      dateRanges: requests.dateRanges,
      dimensions: [{ name: SCROLL_PERCENT_DIMENSION }],
      metrics: [{ name: "totalUsers" }],
      dimensionFilter: requests.dimensionFilter,
    };
    try {
      const response = await client.runReport(propertyId, request);
      const rows = parseReport(response);
      const users = new Map(rows.map((item) => [Number(item.dimensions[SCROLL_PERCENT_DIMENSION]), item.metrics.totalUsers ?? 0]));
      const data = SCROLL_MILESTONES.map((percent) => ({ percent, totalUsers: users.get(percent) ?? 0 }));
      return { status: rows.length ? "ok" : "no_data", data };
    } catch (error) {
      return failed(error);
    }
  }

  private funnelSection(
    funnel: Section<FunnelResult>,
    core: Section<{ events: { current: Record<string, { totalUsers: number }>; previous: Record<string, { totalUsers: number }> | null } }>,
    range: "current" | "previous" = "current",
  ) {
    if (funnel.status === "ok" || funnel.status === "no_data") {
      return { ...funnel, method: "funnel_report" as const };
    }
    const events = range === "current" ? core.data?.events.current : core.data?.events.previous;
    if (!events) return { ...funnel, method: "funnel_report" as const };
    const steps = [
      { name: "Usuários com page_view", activeUsers: events[EVENT_PAGE_VIEW]?.totalUsers ?? 0 },
      { name: "Usuários com click_whatsapp", activeUsers: events[EVENT_WHATSAPP]?.totalUsers ?? 0 },
    ].map((step) => ({ ...step, completionRate: null, abandonments: null, abandonmentRate: null }));
    return {
      status: "ok" as SectionStatus,
      method: "event_ratio_fallback" as const,
      message: `runFunnelReport indisponível (${funnel.message ?? funnel.status}). Razão simples entre usuários dos dois eventos, sem exigir sequência.`,
      data: { steps, progressionRate: progressionRate(steps), byDevice: [] },
    };
  }

  private withEmptyStatus<T extends { hasData: boolean }>(section: Section<T>): Section<T> {
    if (section.status === "ok" && section.data && !section.data.hasData) {
      return { ...section, status: "no_data" };
    }
    return section;
  }

  private async funnel(
    client: Ga4Client,
    propertyId: string,
    environment: Ga4Environment,
    filters: Ga4QueryFilters,
    range: { since: string; until: string },
  ): Promise<Section<FunnelResult>> {
    try {
      const parsed = parseFunnel(await client.runFunnelReport(propertyId, buildFunnelRequest(environment, filters, range)));
      return { status: parsed.steps[0]!.activeUsers > 0 ? "ok" : "no_data", data: parsed };
    } catch (error) {
      if (error instanceof Ga4ApiError) {
        this.logger.warn(`runFunnelReport falhou (${error.kind}, HTTP ${error.httpStatus})`);
      }
      return failed(error);
    }
  }

  private async batch(
    client: Ga4Client,
    propertyId: string,
    keys: string[],
    requests: unknown[],
  ): Promise<Section<Record<string, Ga4ReportResponse | undefined>>> {
    try {
      const reports: Ga4ReportResponse[] = [];
      for (let start = 0; start < requests.length; start += 5) {
        const response = await client.batchRunReports(propertyId, requests.slice(start, start + 5));
        reports.push(...(response.reports ?? []));
      }
      return { status: "ok", data: Object.fromEntries(keys.map((key, index) => [key, reports[index]])) };
    } catch (error) {
      return failed(error);
    }
  }

  private mapSection<T>(
    section: Section<Record<string, Ga4ReportResponse | undefined>>,
    map: (reports: Record<string, Ga4ReportResponse | undefined>) => T,
  ): Section<T> {
    if (section.status !== "ok" || !section.data) return { status: section.status, message: section.message, data: null };
    return { status: "ok", data: map(section.data) };
  }

  private async section<T>(load: () => Promise<T>): Promise<Section<T>> {
    try {
      return { status: "ok", data: await load() };
    } catch (error) {
      return failed(error);
    }
  }

  private async metadataDimensions(row: ConnectionRow, client: Ga4Client, refresh: boolean): Promise<Set<string>> {
    const key = `metadata:${row.workspaceId}:${row.propertyId}:${row.updatedAt.getTime()}`;
    const cached = this.cache.get(key);
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value as Set<string>;
    const metadata = await client.getMetadata(row.propertyId);
    const names = new Set((metadata.dimensions ?? []).map((dimension) => dimension.apiName));
    this.remember(key, names, METADATA_TTL_MS);
    return names;
  }

  private parseFilters(query: Ga4ReportQuery): Ga4QueryFilters {
    const today = new Date().toISOString().slice(0, 10);
    const until = query.until ?? today;
    const since = query.since ?? new Date(Date.parse(`${until}T00:00:00Z`) - 27 * 86_400_000).toISOString().slice(0, 10);
    if (!DATE_PATTERN.test(since) || !DATE_PATTERN.test(until) || since > until) {
      throw new BadRequestException("Período inválido");
    }
    if ((Date.parse(until) - Date.parse(since)) / 86_400_000 > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Período máximo de ${MAX_RANGE_DAYS} dias`);
    }
    const clean = (value?: string) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed.slice(0, 200) : undefined;
    };
    const current = { since, until };
    return {
      current,
      previous: query.compare ? previousPeriod(current) : null,
      device: clean(query.device),
      sourceMedium: clean(query.sourceMedium),
      campaign: clean(query.campaign),
    };
  }

  private environmentsOf(row: ConnectionRow): Ga4Environment[] {
    const parsed = ga4EnvironmentsSchema.safeParse(row.environments);
    return parsed.success ? parsed.data : comporvetEnvironmentPreset;
  }

  private async requireConnection(workspaceId: string): Promise<ConnectionRow> {
    const row = (await this.prisma.googleAnalyticsConnection.findUnique({ where: { workspaceId } })) as ConnectionRow | null;
    if (!row) throw new NotFoundException("GA4 ainda não configurado neste workspace");
    return row;
  }

  private clientFor(row: ConnectionRow): Ga4Client {
    const cached = this.clients.get(row.workspaceId);
    if (cached && cached.updatedAt === row.updatedAt.getTime()) return cached.client;
    let key;
    try {
      key = decryptServiceAccountKey(this.env, row.workspaceId, row);
    } catch {
      throw new BadRequestException("Não foi possível ler a chave salva. Envie a chave JSON de novo.");
    }
    const client = new Ga4Client(key, this.fetchFn);
    this.clients.set(row.workspaceId, { updatedAt: row.updatedAt.getTime(), client });
    return client;
  }

  private async recordError(workspaceId: string, error: unknown) {
    if (!(error instanceof Ga4ApiError)) return;
    await this.prisma.googleAnalyticsConnection.updateMany({
      where: { workspaceId },
      data: { lastErrorKind: statusFromError(error.kind), lastErrorMessage: error.message.slice(0, 500) },
    });
  }

  private remember(key: string, value: unknown, ttl: number) {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { expiresAt: Date.now() + ttl, value });
  }

  private invalidate(workspaceId: string) {
    this.clients.delete(workspaceId);
    for (const key of this.cache.keys()) {
      if (key.includes(workspaceId)) this.cache.delete(key);
    }
  }
}
