import type { Ga4EnvironmentReport } from "./ga4-types";

export type MetricFormat = "integer" | "percent" | "seconds" | "decimal";

export type ComparisonValue = { current: number | null; previous: number | null };

export type ComparisonRow = {
  key: string;
  label: string;
  hint: string;
  source: string;
  format: MetricFormat;
  values: Record<string, ComparisonValue>;
};

const ratio = (numerator: number | undefined, denominator: number | undefined, scale: number) =>
  numerator === undefined || !denominator ? null : (numerator / denominator) * scale;

function scrollUsersAt(report: Ga4EnvironmentReport, percent: number) {
  return report.scrollUsers.data?.find((item) => item.percent === percent)?.totalUsers;
}

type Definition = Omit<ComparisonRow, "values"> & {
  read: (report: Ga4EnvironmentReport, range: "current" | "previous") => number | null;
};

const definitions: Definition[] = [
  {
    key: "totalUsers",
    label: "Usuários",
    hint: "totalUsers: usuários distintos no período",
    source: "GA4",
    format: "integer",
    read: (report, range) => report.core.data?.totals[range]?.totalUsers ?? null,
  },
  {
    key: "activeUsers",
    label: "Usuários ativos",
    hint: "activeUsers: usuários com sessão engajada ou primeira visita",
    source: "GA4",
    format: "integer",
    read: (report, range) => report.core.data?.totals[range]?.activeUsers ?? null,
  },
  {
    key: "sessions",
    label: "Sessões",
    hint: "sessions",
    source: "GA4",
    format: "integer",
    read: (report, range) => report.core.data?.totals[range]?.sessions ?? null,
  },
  {
    key: "screenPageViews",
    label: "Visualizações",
    hint: "screenPageViews",
    source: "GA4",
    format: "integer",
    read: (report, range) => report.core.data?.totals[range]?.screenPageViews ?? null,
  },
  {
    key: "engagementRate",
    label: "Taxa de engajamento",
    hint: "engagementRate: sessões engajadas / sessões",
    source: "GA4",
    format: "percent",
    read: (report, range) => {
      const value = report.core.data?.totals[range]?.engagementRate;
      return value === undefined ? null : value * 100;
    },
  },
  {
    key: "averageEngagementTimePerSession",
    label: "Engajamento médio por sessão",
    hint: "averageEngagementTimePerSession, em segundos",
    source: "GA4",
    format: "seconds",
    read: (report, range) => report.core.data?.totals[range]?.averageEngagementTimePerSession ?? null,
  },
  {
    key: "whatsappEvents",
    label: "Cliques no WhatsApp (eventos)",
    hint: "eventCount de click_whatsapp. Um usuário pode clicar várias vezes",
    source: "GA4",
    format: "integer",
    read: (report, range) => report.core.data?.events[range]?.click_whatsapp?.eventCount ?? null,
  },
  {
    key: "whatsappUsers",
    label: "Usuários que clicaram no WhatsApp",
    hint: "totalUsers com click_whatsapp",
    source: "GA4",
    format: "integer",
    read: (report, range) => report.core.data?.events[range]?.click_whatsapp?.totalUsers ?? null,
  },
  {
    key: "clicksPer100Views",
    label: "Cliques por 100 visualizações",
    hint: "eventos click_whatsapp / screenPageViews × 100",
    source: "GA4 (calculado)",
    format: "decimal",
    read: (report, range) =>
      ratio(
        report.core.data?.events[range]?.click_whatsapp?.eventCount,
        report.core.data?.totals[range]?.screenPageViews,
        100,
      ),
  },
  {
    key: "funnelProgression",
    label: "Taxa de progressão do funil",
    hint: "usuários na etapa 2 / usuários na etapa 1 × 100 (relatório de funil)",
    source: "GA4 funil",
    format: "percent",
    read: (report, range) => {
      const funnel = range === "current" ? report.funnel : report.previousFunnel;
      return funnel?.data?.progressionRate ?? null;
    },
  },
  {
    key: "scroll50",
    label: "Usuários que alcançaram pelo menos 50%",
    hint: "totalUsers de scroll_depth com scroll_percent = 50",
    source: "GA4",
    format: "integer",
    read: (report, range) => (range === "current" ? scrollUsersAt(report, 50) ?? null : null),
  },
  {
    key: "scroll90",
    label: "Usuários que alcançaram pelo menos 90%",
    hint: "totalUsers de scroll_depth com scroll_percent = 90",
    source: "GA4",
    format: "integer",
    read: (report, range) => (range === "current" ? scrollUsersAt(report, 90) ?? null : null),
  },
];

export function comparisonRows(reports: Ga4EnvironmentReport[]): ComparisonRow[] {
  return definitions.map(({ read, ...definition }) => ({
    ...definition,
    values: Object.fromEntries(
      reports.map((report) => [report.key, { current: read(report, "current"), previous: read(report, "previous") }]),
    ),
  }));
}

export function formatMetric(value: number | null, format: MetricFormat): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (format === "percent") return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (format === "decimal") return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  if (format === "seconds") {
    const total = Math.round(value);
    return `${Math.floor(total / 60)}min ${String(total % 60).padStart(2, "0")}s`;
  }
  return Math.round(value).toLocaleString("pt-BR");
}

export function variation({ current, previous }: ComparisonValue): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function csvCell(value: string) {
  return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function comparisonCsv(rows: ComparisonRow[], reports: Ga4EnvironmentReport[], period: string): string {
  const header = ["Indicador", "Fonte", ...reports.flatMap((report) => [report.label, `${report.label} (anterior)`])];
  const lines = rows.map((row) => [
    row.label,
    row.source,
    ...reports.flatMap((report) => {
      const value = row.values[report.key];
      return [value?.current ?? "", value?.previous ?? ""].map((item) =>
        typeof item === "number" ? String(Math.round(item * 100) / 100).replace(".", ",") : "",
      );
    }),
  ]);
  return [`Período;${period}`, header, ...lines]
    .map((line) => (Array.isArray(line) ? line.map(csvCell).join(";") : line))
    .join("\n");
}
