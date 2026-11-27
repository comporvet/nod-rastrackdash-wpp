export type OriginTouch = {
  channel: string;
  confidence: "confirmed" | "probable" | null;
  campaign: string | null;
  source: string | null;
  medium: string | null;
  environment: string;
  at: string;
};

export type LeadOriginRow = {
  at: string;
  entry: string;
  name: string | null;
  channel: string;
  group: "paid" | "organic";
  confidence: "confirmed" | "probable" | null;
  campaign: string | null;
  firstTouch: OriginTouch | null;
  lastNonDirect: OriginTouch | null;
  visits: number;
  refToken: string | null;
};

export type LeadOriginReport = {
  since: string;
  until: string;
  lookbackDays: number;
  total: number;
  paid: number;
  organic: number;
  byChannel: { channel: string; count: number; probable: number }[];
  rows: LeadOriginRow[];
  truncated: boolean;
};

export const channelLabels: Record<string, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads (site/LP)",
  meta_ctwa: "Meta Ads (Click-to-WhatsApp)",
  organic_search: "Busca orgânica",
  organic_social: "Social orgânico",
  referral: "Outro site",
  other: "Outras origens",
  direct: "Direto no site",
  whatsapp_direct: "WhatsApp direto",
  unknown: "Sem dados da visita",
};

export const paidChannels = ["google_ads", "meta_ads", "meta_ctwa"];
export const organicChannels = [
  "organic_search",
  "organic_social",
  "referral",
  "other",
  "direct",
  "whatsapp_direct",
  "unknown",
];

export const entryLabels: Record<string, string> = {
  site: "Site institucional",
  lp_online: "LP Online",
  lp_presencial: "LP Presencial",
  unknown_page: "Site/LP",
  ctwa: "Anúncio Click-to-WhatsApp",
  whatsapp_direct: "WhatsApp direto",
};

export function channelLabel(channel: string): string {
  return channelLabels[channel] ?? channel;
}

export function share(count: number, total: number): string {
  if (total === 0) return "—";
  return `${((count / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export function channelCounts(report: Pick<LeadOriginReport, "byChannel">, channels: string[]) {
  const map = new Map(report.byChannel.map((row) => [row.channel, row]));
  return channels.map((channel) => ({
    channel,
    count: map.get(channel)?.count ?? 0,
    probable: map.get(channel)?.probable ?? 0,
  }));
}

export function filterRows(rows: LeadOriginRow[], filter: { group?: string; channel?: string }): LeadOriginRow[] {
  return rows.filter(
    (row) => (!filter.group || row.group === filter.group) && (!filter.channel || row.channel === filter.channel),
  );
}

export function touchText(touch: OriginTouch | null): string {
  if (!touch) return "—";
  const label = channelLabel(touch.channel);
  return touch.campaign ? `${label} · ${touch.campaign}` : label;
}
