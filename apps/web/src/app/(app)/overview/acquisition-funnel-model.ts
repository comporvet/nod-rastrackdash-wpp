export type FunnelStage = {
  key: string;
  label: string;
  value: number | null;
  note: string | null;
  breakdown: { label: string; value: number }[];
};

export type AcquisitionFunnelData = {
  since: string;
  until: string;
  filters: { group: string; channel: string; entry: string; campaignIds: string[] };
  spendCents: number | null;
  lookbackDays: number;
  sources: { customers: string; appointments: string };
  stages: FunnelStage[];
};

export const FUNNEL_PARAM = { group: "funnelGroup", channel: "funnelChannel", entry: "funnelEntry" } as const;

export const groupOptions = [
  { value: "all", label: "Todo o tráfego" },
  { value: "paid", label: "Tráfego pago" },
  { value: "organic", label: "Tráfego orgânico" },
];

export const channelOptions = [
  { value: "all", label: "Todos os canais" },
  { value: "google_ads", label: "Google Ads" },
  { value: "meta_ads", label: "Meta Ads (site/LP)" },
  { value: "meta_ctwa", label: "Meta Ads (Click-to-WhatsApp)" },
  { value: "organic_search", label: "Busca orgânica" },
  { value: "organic_social", label: "Social orgânico" },
  { value: "referral", label: "Outro site" },
  { value: "direct", label: "Direto no site" },
  { value: "whatsapp_direct", label: "WhatsApp direto" },
  { value: "other", label: "Outras origens" },
  { value: "unknown", label: "Sem dados da visita" },
];

export const entryOptions = [
  { value: "all", label: "Todas as entradas" },
  { value: "site", label: "Site institucional" },
  { value: "lp_online", label: "LP Online" },
  { value: "lp_presencial", label: "LP Presencial" },
  { value: "ctwa", label: "Anúncio Click-to-WhatsApp" },
  { value: "whatsapp_direct", label: "WhatsApp direto" },
];

export function isFunnelData(value: unknown): value is AcquisitionFunnelData {
  const data = value as Partial<AcquisitionFunnelData> | null;
  return Boolean(
    data &&
      Array.isArray(data.stages) &&
      data.stages.every((stage) => typeof stage?.key === "string" && typeof stage?.label === "string") &&
      typeof data.filters === "object",
  );
}

export type FunnelRow = FunnelStage & {
  /** 0..1 width for the funnel shape (log scale so 10k impressions and 3 customers both show). */
  width: number;
  fromPrevious: number | null;
  fromTop: number | null;
  costCents: number | null;
};

const MIN_WIDTH = 0.22;

export function funnelRows(data: Pick<AcquisitionFunnelData, "stages" | "spendCents">): FunnelRow[] {
  const values = data.stages.map((stage) => stage.value).filter((value): value is number => value !== null);
  const max = Math.max(1, ...values);
  const top = data.stages.find((stage) => stage.value !== null && stage.value > 0)?.value ?? null;
  let previous: number | null = null;
  return data.stages.map((stage, index) => {
    const value = stage.value;
    const width =
      value === null || value <= 0
        ? MIN_WIDTH
        : MIN_WIDTH + (1 - MIN_WIDTH) * (Math.log10(value + 1) / Math.log10(max + 1));
    const fromPrevious = value !== null && previous !== null && previous > 0 ? value / previous : null;
    const fromTop = value !== null && top !== null && top > 0 && index > 0 ? value / top : null;
    const costCents =
      data.spendCents !== null && data.spendCents > 0 && value !== null && value > 0 && stage.key !== "impressions"
        ? Math.round(data.spendCents / value)
        : null;
    if (value !== null) previous = value;
    return { ...stage, width, fromPrevious, fromTop, costCents };
  });
}

export function percent(value: number | null): string {
  if (value === null) return "—";
  const pct = value * 100;
  return `${pct.toLocaleString("pt-BR", { maximumFractionDigits: pct < 1 ? 2 : 1 })}%`;
}

export function brl(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function integer(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("pt-BR");
}

/** Trapezoid points for stage i in a viewBox of width 100 and `height` per stage. */
export function trapezoid(rows: FunnelRow[], index: number, height: number): string {
  const top = rows[index]!.width * 100;
  const next = rows[index + 1]?.width ?? rows[index]!.width * 0.85;
  const bottom = Math.min(top, next * 100);
  const y = index * height;
  const gap = 1.2;
  const left = (100 - top) / 2;
  const leftBottom = (100 - bottom) / 2;
  return [
    `${left},${y}`,
    `${left + top},${y}`,
    `${leftBottom + bottom},${y + height - gap}`,
    `${leftBottom},${y + height - gap}`,
  ]
    .map((point) => point)
    .join(" ");
}
