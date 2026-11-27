import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { monitorRange } from "./tracking.service";
import { resolveOrigin, type OriginConfidence, type OriginGroup, type Touch, type TouchEvent } from "./traffic-origin";

export const ORIGIN_LOOKBACK_MS = 90 * 86_400_000;
const MAX_ROWS = 200;

export type LeadOriginChannel =
  | "google_ads"
  | "meta_ads"
  | "meta_ctwa"
  | "organic_search"
  | "organic_social"
  | "referral"
  | "other"
  | "direct"
  | "whatsapp_direct"
  | "unknown";

export type LeadEntry = "site" | "lp_online" | "lp_presencial" | "unknown_page" | "ctwa" | "whatsapp_direct";

type TouchDto = {
  channel: string;
  confidence: OriginConfidence | null;
  campaign: string | null;
  source: string | null;
  medium: string | null;
  environment: string;
  at: string;
};

export type LeadOriginRow = {
  at: string;
  entry: LeadEntry;
  name: string | null;
  channel: LeadOriginChannel;
  group: OriginGroup;
  confidence: OriginConfidence | null;
  campaign: string | null;
  firstTouch: TouchDto | null;
  lastNonDirect: TouchDto | null;
  visits: number;
  refToken: string | null;
};

function touchDto(item: Touch | null): TouchDto | null {
  return item
    ? {
        channel: item.channel,
        confidence: item.confidence,
        campaign: item.campaign,
        source: item.source,
        medium: item.medium,
        environment: item.environment,
        at: item.at.toISOString(),
      }
    : null;
}

function entryOf(environment: string | null | undefined): LeadEntry {
  return environment === "site" || environment === "lp_online" || environment === "lp_presencial"
    ? environment
    : "unknown_page";
}

/**
 * Origin of the site/LP contacts linked by the WhatsApp code, from every
 * session of the same browser (client_id) in the 90 days before the message.
 * The first touch is the lead's origin; the last non-direct touch is shown too.
 */
export function siteLeadOrigin(
  match: { messageAt: Date; contactName: string | null; refToken: string; clickEnvironment: string | null },
  events: TouchEvent[],
): LeadOriginRow {
  const windowStart = match.messageAt.getTime() - ORIGIN_LOOKBACK_MS;
  const inWindow = events.filter(
    (event) => event.eventTime.getTime() >= windowStart && event.eventTime.getTime() <= match.messageAt.getTime(),
  );
  const origin = resolveOrigin(inWindow);
  const first = origin.first;
  return {
    at: match.messageAt.toISOString(),
    entry: entryOf(match.clickEnvironment),
    name: match.contactName,
    channel: first ? first.channel : "unknown",
    group: first ? first.group : "organic",
    confidence: first ? first.confidence : null,
    campaign: first?.campaign ?? null,
    firstTouch: touchDto(first),
    lastNonDirect: touchDto(origin.lastNonDirect),
    visits: origin.visits,
    refToken: match.refToken,
  };
}

/** Internal row: the phone hashes and Meta campaign never leave the API. */
export type CollectedLead = LeadOriginRow & { phoneHashes: string[]; metaCampaignId: string | null };

export function summarize(rows: LeadOriginRow[]) {
  const byChannel = new Map<string, { count: number; probable: number }>();
  let paid = 0;
  for (const row of rows) {
    if (row.group === "paid") paid += 1;
    const current = byChannel.get(row.channel) ?? { count: 0, probable: 0 };
    current.count += 1;
    if (row.confidence === "probable") current.probable += 1;
    byChannel.set(row.channel, current);
  }
  return {
    total: rows.length,
    paid,
    organic: rows.length - paid,
    byChannel: [...byChannel.entries()]
      .map(([channel, value]) => ({ channel, ...value }))
      .sort((a, b) => b.count - a.count),
  };
}

@Injectable()
export class LeadOriginService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async collect(workspaceId: string, from: Date, to: Date): Promise<CollectedLead[]> {
    const [ctwaRows, ctwaHashes] = await this.ctwaLeads(workspaceId, from, to);
    const [siteRows, siteHashes] = await this.siteLeads(workspaceId, from, to, ctwaHashes);
    const directRows = await this.whatsappDirect(workspaceId, from, to, new Set([...siteHashes, ...ctwaHashes]));
    return [...ctwaRows, ...siteRows, ...directRows].sort((a, b) => b.at.localeCompare(a.at));
  }

  async report(workspaceId: string, query: { since?: string; until?: string }) {
    const range = monitorRange(query.since, query.until);
    const rows: LeadOriginRow[] = (await this.collect(workspaceId, range.from, range.to)).map(
      ({ phoneHashes: _phoneHashes, metaCampaignId: _metaCampaignId, ...row }) => row,
    );
    return {
      since: range.since,
      until: range.until,
      lookbackDays: ORIGIN_LOOKBACK_MS / 86_400_000,
      ...summarize(rows),
      rows: rows.slice(0, MAX_ROWS),
      truncated: rows.length > MAX_ROWS,
    };
  }

  private async siteLeads(
    workspaceId: string,
    from: Date,
    to: Date,
    ctwaHashes: Set<string>,
  ): Promise<[CollectedLead[], Set<string>]> {
    const matches = await this.prisma.trackingContactMatch.findMany({
      where: { workspaceId, messageAt: { gte: from, lt: to } },
      select: {
        refToken: true,
        messageAt: true,
        contactName: true,
        phoneHashes: true,
        trackingEvent: { select: { clientId: true, environment: true } },
      },
    });
    const clientIds = [
      ...new Set(matches.map((match) => match.trackingEvent?.clientId).filter((id): id is string => Boolean(id))),
    ];
    const events = clientIds.length
      ? await this.prisma.trackingEvent.findMany({
          where: {
            workspaceId,
            clientId: { in: clientIds },
            eventTime: { gte: new Date(from.getTime() - ORIGIN_LOOKBACK_MS), lt: to },
          },
          select: {
            clientId: true,
            eventTime: true,
            sessionId: true,
            environment: true,
            pageReferrerHost: true,
            attribution: true,
          },
        })
      : [];
    const byClient = new Map<string, TouchEvent[]>();
    for (const event of events) {
      const list = byClient.get(event.clientId!) ?? [];
      list.push(event);
      byClient.set(event.clientId!, list);
    }
    const hashes = new Set<string>();
    const rows: CollectedLead[] = [];
    for (const match of matches) {
      match.phoneHashes.forEach((hash) => hashes.add(hash));
      if (match.phoneHashes.some((hash) => ctwaHashes.has(hash))) continue;
      const clientId = match.trackingEvent?.clientId;
      rows.push({
        ...siteLeadOrigin(
          {
            messageAt: match.messageAt,
            contactName: match.contactName,
            refToken: match.refToken,
            clickEnvironment: match.trackingEvent?.environment ?? null,
          },
          clientId ? byClient.get(clientId) ?? [] : [],
        ),
        phoneHashes: match.phoneHashes,
        metaCampaignId: null,
      });
    }
    return [rows, hashes];
  }

  private async ctwaLeads(workspaceId: string, from: Date, to: Date): Promise<[CollectedLead[], Set<string>]> {
    const leads = await this.prisma.lead.findMany({
      where: {
        workspaceId,
        ctwaClid: { not: null },
        OR: [
          { firstMessageAt: { gte: from, lt: to } },
          { firstMessageAt: null, createdAt: { gte: from, lt: to } },
        ],
      },
      select: { name: true, phoneHash: true, campaignId: true, firstMessageAt: true, createdAt: true },
    });
    const campaignIds = [...new Set(leads.map((lead) => lead.campaignId).filter((id): id is string => Boolean(id)))];
    const campaigns = campaignIds.length
      ? await this.prisma.metaCampaign.findMany({
          where: { workspaceId, campaignId: { in: campaignIds } },
          select: { campaignId: true, name: true },
        })
      : [];
    const campaignName = new Map(campaigns.map((campaign) => [campaign.campaignId, campaign.name]));
    const hashes = new Set<string>();
    const rows: CollectedLead[] = [];
    for (const lead of leads) {
      hashes.add(lead.phoneHash);
      rows.push({
        at: (lead.firstMessageAt ?? lead.createdAt).toISOString(),
        entry: "ctwa",
        name: lead.name,
        channel: "meta_ctwa",
        group: "paid",
        confidence: "confirmed",
        campaign: lead.campaignId ? campaignName.get(lead.campaignId) ?? lead.campaignId : null,
        firstTouch: null,
        lastNonDirect: null,
        visits: 0,
        refToken: null,
        phoneHashes: [lead.phoneHash],
        metaCampaignId: lead.campaignId,
      });
    }
    return [rows, hashes];
  }

  /**
   * Official WhatsApp contacts whose first recorded message falls in the
   * period, with no click code and no CTWA ad: organic by the user's rule.
   */
  private async whatsappDirect(
    workspaceId: string,
    from: Date,
    to: Date,
    knownHashes: Set<string>,
  ): Promise<CollectedLead[]> {
    const baseWhere = {
      workspaceId,
      contactIdentityHash: { not: null },
      connection: { is: { provider: "meta_cloud" as const } },
    };
    const firsts = await this.prisma.inboundWebhookEvent.groupBy({
      by: ["contactIdentityHash"],
      where: baseWhere,
      _min: { occurredAt: true },
    });
    const inPeriod = firsts.filter((row) => {
      const first = row._min.occurredAt;
      return row.contactIdentityHash && first && first >= from && first < to;
    });
    if (inPeriod.length === 0) return [];
    const ctwaContacts = await this.prisma.inboundWebhookEvent.findMany({
      where: { ...baseWhere, hasCtwa: true, contactIdentityHash: { in: inPeriod.map((row) => row.contactIdentityHash!) } },
      select: { contactIdentityHash: true },
      distinct: ["contactIdentityHash"],
    });
    const linkedAnyTime = await this.prisma.trackingContactMatch.findMany({
      where: { workspaceId },
      select: { phoneHashes: true },
    });
    const excluded = new Set<string>([
      ...knownHashes,
      ...ctwaContacts.map((row) => row.contactIdentityHash!),
      ...linkedAnyTime.flatMap((row) => row.phoneHashes),
    ]);
    return inPeriod
      .filter((row) => !excluded.has(row.contactIdentityHash!))
      .map((row) => ({
        at: row._min.occurredAt!.toISOString(),
        entry: "whatsapp_direct" as const,
        name: null,
        channel: "whatsapp_direct" as const,
        group: "organic" as const,
        confidence: null,
        campaign: null,
        firstTouch: null,
        lastNonDirect: null,
        visits: 0,
        refToken: null,
        phoneHashes: [row.contactIdentityHash!],
        metaCampaignId: null,
      }));
  }
}
