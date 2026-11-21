export type Ga4SectionStatus =
  | "ok"
  | "no_data"
  | "incomplete_config"
  | "unauthorized"
  | "quota"
  | "temporary_error"
  | "invalid_request";

export type Ga4Section<T> = { status: Ga4SectionStatus; message?: string; data: T | null };

export type Ga4Environment = { key: string; label: string; hostPattern: string; pathPattern?: string };

export type Ga4Totals = {
  totalUsers: number;
  activeUsers: number;
  sessions: number;
  screenPageViews: number;
  engagedSessions: number;
  engagementRate: number;
  averageEngagementTimePerSession: number;
};

export type Ga4EventTotals = Record<string, { eventCount: number; totalUsers: number }>;

export type Ga4DailyPoint = {
  date: string;
  sessions: number;
  screenPageViews: number;
  totalUsers: number;
  whatsappClicks: number;
};

export type Ga4FunnelStep = {
  name: string;
  activeUsers: number;
  completionRate: number | null;
  abandonments: number | null;
  abandonmentRate: number | null;
};

export type Ga4Funnel = Ga4Section<{
  steps: Ga4FunnelStep[];
  progressionRate: number | null;
  byDevice: { device: string; steps: Ga4FunnelStep[]; progressionRate: number | null }[];
}> & { method: "funnel_report" | "event_ratio_fallback" };

export type Ga4AcquisitionRow = {
  value: string;
  sessions: number;
  activeUsers: number;
  engagedSessions: number;
  screenPageViews: number;
};

export type Ga4EnvironmentReport = {
  key: string;
  label: string;
  definition: Ga4Environment;
  core: Ga4Section<{
    totals: { current: Ga4Totals; previous: Ga4Totals | null };
    events: { current: Ga4EventTotals; previous: Ga4EventTotals | null };
    daily: Ga4DailyPoint[];
  }>;
  scroll: Ga4Section<{
    byPage: { pagePath: string; percent: number; totalUsers: number; eventCount: number }[];
    milestones: { percent: number; eventCount: number; pages: number }[];
    otherValues: number[];
  }>;
  scrollUsers: Ga4Section<{ percent: number; totalUsers: number }[]>;
  acquisition: Ga4Section<Record<"sourceMedium" | "channel" | "campaign" | "device", Ga4AcquisitionRow[]>>;
  funnel: Ga4Funnel;
  previousFunnel: Ga4Funnel | null;
};

export type Ga4Report = {
  status: Ga4SectionStatus;
  message?: string;
  propertyId?: string;
  generatedAt?: string;
  filters?: {
    current: { since: string; until: string };
    previous: { since: string; until: string } | null;
    device?: string;
    sourceMedium?: string;
    campaign?: string;
    includeTestTraffic?: boolean;
  };
  testTrafficSources?: string[];
  customDimensions?: Record<string, boolean>;
  environments?: Ga4EnvironmentReport[];
};

export type Ga4Connection =
  | { configured: false; environmentPreset: Ga4Environment[] }
  | {
      configured: true;
      propertyId: string;
      serviceAccountEmail: string;
      environments: Ga4Environment[];
      expectedMeasurementIds: string[];
      lastValidatedAt: string | null;
      lastErrorKind: string | null;
      lastErrorMessage: string | null;
      environmentPreset: Ga4Environment[];
    };

export const sectionStatusCopy: Record<Ga4SectionStatus, { label: string; tone: "" | "warn" | "bad" | "neutral" }> = {
  ok: { label: "Conectado", tone: "" },
  no_data: { label: "Sem dados para o período", tone: "neutral" },
  incomplete_config: { label: "Configuração incompleta", tone: "warn" },
  unauthorized: { label: "Sem autorização", tone: "bad" },
  quota: { label: "Cota da API esgotada", tone: "warn" },
  temporary_error: { label: "Erro temporário de API", tone: "warn" },
  invalid_request: { label: "Consulta recusada pela API", tone: "bad" },
};

const environmentPalette = ["#4d82ff", "#12a873", "#c2701c"];

export function environmentColor(index: number): string {
  return environmentPalette[index] ?? "#6f8a84";
}
