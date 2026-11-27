import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { ComporvetDataService, type ComporvetAppointments, type ComporvetCustomers } from "./comporvet-data.service";
import { LeadOriginService, ORIGIN_LOOKBACK_MS, type CollectedLead } from "./lead-origin.service";
import { monitorRange } from "./tracking.service";
import { resolveOrigin, sessionTouches, type Touch, type TouchEvent } from "./traffic-origin";

export const FUNNEL_GROUPS = ["all", "paid", "organic"] as const;
export const FUNNEL_CHANNELS = [
  "all",
  "google_ads",
  "meta_ads",
  "meta_ctwa",
  "organic_search",
  "organic_social",
  "referral",
  "other",
  "direct",
  "whatsapp_direct",
  "unknown",
] as const;
export const FUNNEL_ENTRIES = ["all", "site", "lp_online", "lp_presencial", "ctwa", "whatsapp_direct"] as const;

export type FunnelChannel = Exclude<(typeof FUNNEL_CHANNELS)[number], "all">;

export type FunnelFilters = {
  group: (typeof FUNNEL_GROUPS)[number];
  /** Empty = every channel. */
  channels: FunnelChannel[];
  entry: (typeof FUNNEL_ENTRIES)[number];
  campaignIds: string[];
};

export type FunnelStageKey =
  | "impressions"
  | "ad_clicks"
  | "visits"
  | "whatsapp_clicks"
  | "conversations"
  | "scheduled"
  | "customers";

export type FunnelStage = {
  key: FunnelStageKey;
  label: string;
  value: number | null;
  note: string | null;
  breakdown: { label: string; value: number }[];
  /** People counted at this stage who did not come through the stage above (organic visit, CTWA, direct WhatsApp...). */
  entered: { label: string; value: number }[];
};

const VISIT_CHANNEL_LABEL: Record<string, string> = {
  organic_search: "Busca orgânica",
  organic_social: "Redes sociais",
  referral: "Outros sites",
  direct: "Acesso direto",
  other: "Outras origens",
  unknown: "Sem dados da visita",
};

function countBy<T>(items: T[], labelOf: (item: T) => string): { label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(labelOf(item), (counts.get(labelOf(item)) ?? 0) + 1);
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

const SITE_ENTRIES = new Set(["site", "lp_online", "lp_presencial"]);
const PAID_CHANNELS = new Set(["google_ads", "meta_ads", "meta_ctwa"]);
const SAO_PAULO_OFFSET_MS = 3 * 3_600_000;

function pick<T extends readonly string[]>(value: string | undefined, allowed: T, name: string): T[number] {
  if (!value) return allowed[0] as T[number];
  if ((allowed as readonly string[]).includes(value)) return value as T[number];
  throw new BadRequestException(`Filtro ${name} inválido`);
}

export function parseFunnelFilters(query: {
  group?: string;
  channel?: string;
  entry?: string;
  campaignIds?: string;
}): FunnelFilters {
  return {
    group: pick(query.group, FUNNEL_GROUPS, "group"),
    channels: [
      ...new Set(
        (query.channel ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value && value !== "all")
          .map((value) => pick(value, FUNNEL_CHANNELS, "channel") as FunnelChannel),
      ),
    ],
    entry: pick(query.entry, FUNNEL_ENTRIES, "entry"),
    campaignIds: (query.campaignIds ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => /^[\w.-]{1,64}$/.test(id))
      .slice(0, 50),
  };
}

function groupOfChannel(channel: string): "paid" | "organic" {
  return PAID_CHANNELS.has(channel) ? "paid" : "organic";
}

function saoPauloDay(date: Date): string {
  return new Date(date.getTime() - SAO_PAULO_OFFSET_MS).toISOString().slice(0, 10);
}

/** Does a visitor/lead with this channel, entry and campaign pass the filters? */
export function passes(
  filters: FunnelFilters,
  item: { channel: string; entry: string; campaigns: (string | null)[] },
): boolean {
  if (filters.group !== "all" && groupOfChannel(item.channel) !== filters.group) return false;
  if (filters.channels.length && !filters.channels.includes(item.channel as FunnelChannel)) return false;
  if (filters.entry !== "all" && item.entry !== filters.entry) return false;
  if (filters.campaignIds.length && !item.campaigns.some((id) => id && filters.campaignIds.includes(id))) return false;
  return true;
}

/** Meta ad metrics only make sense for paid Meta traffic and cannot be split by page. */
export function channelSelected(filters: FunnelFilters, ...channels: FunnelChannel[]): boolean {
  return filters.channels.length === 0 || channels.some((channel) => filters.channels.includes(channel));
}

export function metaAdsApply(filters: FunnelFilters): boolean {
  return filters.group !== "organic" && channelSelected(filters, "meta_ads", "meta_ctwa") && filters.entry === "all";
}

export function googleAdsApply(filters: FunnelFilters): boolean {
  return (
    filters.group !== "organic" &&
    channelSelected(filters, "google_ads") &&
    filters.campaignIds.length === 0 &&
    (filters.entry === "all" || SITE_ENTRIES.has(filters.entry))
  );
}

export type VisitorSummary = {
  channel: string;
  campaigns: (string | null)[];
  visitEntries: Set<string>;
  clickEntries: Set<string>;
};

/** Leads that booked: an appointment (not cancelled) created on/after the contact day. */
export function scheduledLeads(leads: CollectedLead[], appointments: ComporvetAppointments): CollectedLead[] {
  return leads.filter((lead) => {
    const contactDay = saoPauloDay(new Date(lead.at));
    return lead.phoneHashes.some((hash) =>
      (appointments.byHash.get(hash) ?? []).some(
        (item) => item.status !== "cancelado" && saoPauloDay(item.createdAt) >= contactDay,
      ),
    );
  });
}

/** New customers: first purchase on/after the contact day. Older customers are counted apart. */
export function customerSplit(leads: CollectedLead[], customers: ComporvetCustomers) {
  const fresh: CollectedLead[] = [];
  const existing: CollectedLead[] = [];
  for (const lead of leads) {
    const purchases = lead.phoneHashes
      .map((hash) => customers.firstPurchaseByHash.get(hash))
      .filter((day): day is string => Boolean(day))
      .sort();
    const first = purchases[0];
    if (!first) continue;
    if (first >= saoPauloDay(new Date(lead.at))) fresh.push(lead);
    else existing.push(lead);
  }
  return { fresh, existing };
}

function leadEntry(lead: CollectedLead): string {
  return lead.entry === "unknown_page" ? "site" : lead.entry;
}

@Injectable()
export class AcquisitionFunnelService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LeadOriginService) private readonly origins: LeadOriginService,
    @Inject(ComporvetDataService) private readonly comporvet: ComporvetDataService,
  ) {}

  async funnel(
    workspaceId: string,
    query: { since?: string; until?: string; group?: string; channel?: string; entry?: string; campaignIds?: string },
  ) {
    const range = monitorRange(query.since, query.until);
    const filters = parseFunnelFilters(query);
    const [meta, visitors, adSessions, leads, customers, appointments] = await Promise.all([
      this.metaTotals(workspaceId, range.since, range.until, filters.campaignIds),
      this.visitors(workspaceId, range.from, range.to),
      this.googleAdSessions(workspaceId, range.from, range.to, filters.entry),
      this.origins.collect(workspaceId, range.from, range.to),
      this.comporvet.customers(),
      this.comporvet.appointments(),
    ]);

    const metaApplies = metaAdsApply(filters);
    const googleApplies = googleAdsApply(filters);
    const visitorsApply = filters.entry === "all" || SITE_ENTRIES.has(filters.entry);
    const visitorChannelApplies =
      filters.channels.length === 0 ||
      filters.channels.some((channel) => channel !== "meta_ctwa" && channel !== "whatsapp_direct");
    const filteredVisitors = visitorsApply && visitorChannelApplies
      ? visitors.filter((visitor) =>
          passes({ ...filters, entry: "all" }, { channel: visitor.channel, entry: "site", campaigns: visitor.campaigns }),
        )
      : [];
    const visited = filteredVisitors.filter((visitor) =>
      filters.entry === "all" ? visitor.visitEntries.size > 0 : visitor.visitEntries.has(filters.entry),
    );
    const clickCount = filteredVisitors.filter((visitor) =>
      filters.entry === "all" ? visitor.clickEntries.size > 0 : visitor.clickEntries.has(filters.entry),
    ).length;

    const filteredLeads = leads.filter((lead) =>
      passes(filters, {
        channel: lead.channel,
        entry: leadEntry(lead),
        campaigns: [lead.metaCampaignId, lead.firstTouch?.campaign ?? null],
      }),
    );
    const scheduled = appointments.status === "ok" ? scheduledLeads(filteredLeads, appointments) : [];
    const split = customers.status === "ok" ? customerSplit(filteredLeads, customers) : { fresh: [], existing: [] };

    const adClicksValue =
      metaApplies || googleApplies
        ? (metaApplies ? meta.linkClicks : 0) + (googleApplies ? adSessions : 0)
        : null;
    const sitePath = visitorsApply && visitorChannelApplies;
    // Visitors whose first touch was not an ad entered the funnel at the visit stage.
    const visitsFromAds = adClicksValue !== null ? visited.filter((visitor) => groupOfChannel(visitor.channel) === "paid") : visited;
    const visitsEntered = adClicksValue !== null ? visited.filter((visitor) => groupOfChannel(visitor.channel) !== "paid") : [];
    // Conversations: code-linked leads come from the WhatsApp click; CTWA comes straight from the ad click.
    const isSiteLead = (lead: CollectedLead) => SITE_ENTRIES.has(lead.entry) || lead.entry === "unknown_page";
    const conversationsCarried = sitePath
      ? filteredLeads.filter(isSiteLead)
      : adClicksValue !== null
        ? filteredLeads.filter((lead) => lead.entry === "ctwa")
        : filteredLeads;
    const carriedSet = new Set(conversationsCarried);
    const conversationsEntered = filteredLeads.filter((lead) => !carriedSet.has(lead));
    const scheduledSet = new Set(scheduled);
    const customersCarried = appointments.status === "ok" ? split.fresh.filter((lead) => scheduledSet.has(lead)) : split.fresh;
    const customersEntered = appointments.status === "ok" ? split.fresh.filter((lead) => !scheduledSet.has(lead)) : [];
    const stages: FunnelStage[] = [
      {
        key: "impressions",
        label: "Impressões dos anúncios",
        value: metaApplies ? meta.impressions : null,
        note: metaApplies
          ? "Meta Ads. Google Ads ainda sem integração."
          : filters.group === "organic"
            ? "Não se aplica a tráfego orgânico."
            : !channelSelected(filters, "meta_ads", "meta_ctwa")
              ? "Google Ads ainda sem integração."
              : "A Meta não separa impressões por página.",
        breakdown: metaApplies ? [{ label: "Meta Ads", value: meta.impressions }] : [],
        entered: [],
      },
      {
        key: "ad_clicks",
        label: "Cliques no anúncio",
        value: adClicksValue,
        note:
          adClicksValue === null
            ? filters.group === "organic"
              ? "Não se aplica a tráfego orgânico."
              : "Sem cliques de anúncio para este filtro."
            : "Meta: cliques no link. Google: visitas com gclid registradas no site/LP.",
        breakdown: [
          ...(metaApplies ? [{ label: "Meta Ads (cliques no link)", value: meta.linkClicks }] : []),
          ...(googleApplies ? [{ label: "Google Ads (visitas com gclid)", value: adSessions }] : []),
        ],
        entered: [],
      },
      {
        key: "visits",
        label: "Visitaram página",
        value: sitePath ? visitsFromAds.length : null,
        note: sitePath
          ? adClicksValue !== null
            ? "Navegadores únicos cuja primeira visita veio de um anúncio."
            : "Navegadores únicos com visualização de página."
          : "Este filtro não passa pelo site/LP.",
        breakdown: [],
        entered: sitePath ? countBy(visitsEntered, (visitor) => VISIT_CHANNEL_LABEL[visitor.channel] ?? "Outras origens") : [],
      },
      {
        key: "whatsapp_clicks",
        label: "Clicaram no WhatsApp",
        value: visitorsApply && visitorChannelApplies ? clickCount : null,
        note: visitorsApply && visitorChannelApplies ? "Navegadores únicos com clique no botão do WhatsApp." : "Este filtro não passa pelo site/LP.",
        breakdown: [],
        entered: [],
      },
      {
        key: "conversations",
        label: "Enviaram mensagem no WhatsApp",
        value: conversationsCarried.length,
        note: [
          sitePath
            ? "Conversas com o código Atendimento do site/LP."
            : adClicksValue !== null
              ? "Conversas vindas do anúncio Click-to-WhatsApp."
              : "Conversas reais recebidas no WhatsApp oficial.",
          metaApplies ? `A Meta informou ${meta.conversations.toLocaleString("pt-BR")} conversas iniciadas pelos anúncios.` : "",
        ]
          .filter(Boolean)
          .join(" "),
        breakdown: [],
        entered: countBy(conversationsEntered, (lead) =>
          lead.entry === "ctwa" ? "Anúncio Click-to-WhatsApp" : lead.entry === "whatsapp_direct" ? "WhatsApp direto" : "Site/LP",
        ),
      },
      {
        key: "scheduled",
        label: "Agendaram consulta",
        value: appointments.status === "ok" ? scheduled.length : null,
        note: sourceNote(appointments.status, "agendamentos (tabela Rastrack_Agendamentos)"),
        breakdown: [],
        entered: [],
      },
      {
        key: "customers",
        label: "Tornaram-se clientes",
        value: customers.status === "ok" ? customersCarried.length : null,
        note:
          customers.status === "ok"
            ? split.existing.length
              ? `Primeira compra após o contato. Outros ${split.existing.length} já eram clientes.`
              : "Primeira compra após o contato."
            : sourceNote(customers.status, "clientes (tabela Clientes)"),
        breakdown: [],
        entered: customersEntered.length ? [{ label: "Compraram sem agendamento registrado", value: customersEntered.length }] : [],
      },
    ];

    return {
      since: range.since,
      until: range.until,
      filters,
      spendCents: metaApplies ? meta.spendCents : null,
      lookbackDays: ORIGIN_LOOKBACK_MS / 86_400_000,
      sources: { customers: customers.status, appointments: appointments.status },
      stages,
    };
  }

  private async metaTotals(workspaceId: string, since: string, until: string, campaignIds: string[]) {
    const totals = await this.prisma.metaCampaignDailyInsight.aggregate({
      where: {
        workspaceId,
        localDate: { gte: since, lte: until },
        ...(campaignIds.length ? { campaignId: { in: campaignIds } } : {}),
      },
      _sum: { impressions: true, linkClicks: true, spendCents: true, metaConversationsStarted: true },
    });
    return {
      impressions: totals._sum.impressions ?? 0,
      linkClicks: totals._sum.linkClicks ?? 0,
      spendCents: totals._sum.spendCents ?? 0,
      conversations: totals._sum.metaConversationsStarted ?? 0,
    };
  }

  /** Browsers with a page view or WhatsApp click in the period, with their first-touch origin. */
  private async visitors(workspaceId: string, from: Date, to: Date): Promise<VisitorSummary[]> {
    const inPeriod = await this.prisma.trackingEvent.findMany({
      where: {
        workspaceId,
        clientId: { not: null },
        eventName: { in: ["page_view", "click_whatsapp"] },
        eventTime: { gte: from, lt: to },
      },
      select: { clientId: true, eventName: true, environment: true },
    });
    const clientIds = [...new Set(inPeriod.map((event) => event.clientId!))];
    if (clientIds.length === 0) return [];
    const history = await this.prisma.trackingEvent.findMany({
      where: {
        workspaceId,
        clientId: { in: clientIds },
        eventTime: { gte: new Date(from.getTime() - ORIGIN_LOOKBACK_MS), lt: to },
      },
      select: { clientId: true, eventTime: true, sessionId: true, environment: true, pageReferrerHost: true, attribution: true },
    });
    const historyByClient = new Map<string, TouchEvent[]>();
    for (const event of history) {
      const list = historyByClient.get(event.clientId!) ?? [];
      list.push(event);
      historyByClient.set(event.clientId!, list);
    }
    const summaries = new Map<string, VisitorSummary>();
    for (const clientId of clientIds) {
      const origin = resolveOrigin(historyByClient.get(clientId) ?? []);
      // Only test sessions (Tag Assistant / Events Manager): not a real visitor.
      if (!origin.first) continue;
      summaries.set(clientId, {
        channel: origin.first.channel,
        campaigns: [origin.first.campaign],
        visitEntries: new Set(),
        clickEntries: new Set(),
      });
    }
    for (const event of inPeriod) {
      const summary = summaries.get(event.clientId!);
      if (!summary) continue;
      (event.eventName === "page_view" ? summary.visitEntries : summary.clickEntries).add(event.environment);
    }
    return [...summaries.values()];
  }

  /** Sessions in the period that landed from a Google Ads click (gclid & co.). */
  private async googleAdSessions(workspaceId: string, from: Date, to: Date, entry: string): Promise<number> {
    const events = await this.prisma.trackingEvent.findMany({
      where: { workspaceId, eventTime: { gte: from, lt: to } },
      select: { eventTime: true, sessionId: true, environment: true, pageReferrerHost: true, attribution: true, clientId: true },
    });
    const byClient = new Map<string, TouchEvent[]>();
    for (const event of events) {
      const key = event.clientId ?? `anon:${event.sessionId ?? event.eventTime.getTime()}`;
      const list = byClient.get(key) ?? [];
      list.push(event);
      byClient.set(key, list);
    }
    let count = 0;
    for (const list of byClient.values()) {
      count += sessionTouches(list).filter(
        (touch: Touch) => touch.channel === "google_ads" && (entry === "all" || touch.environment === entry),
      ).length;
    }
    return count;
  }
}

function sourceNote(status: string, what: string): string | null {
  if (status === "ok") return null;
  if (status === "not_configured") return `Sem acesso ao banco da Comporvet (COMPORVET_DATABASE_URL) para ler ${what}.`;
  if (status === "missing_table") return `A tabela de ${what} ainda não existe no banco da Comporvet.`;
  return `Não foi possível ler ${what} agora.`;
}
