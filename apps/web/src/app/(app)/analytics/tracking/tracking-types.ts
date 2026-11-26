export type TrackingConnectionState = {
  enabled: boolean;
  endpointUrl: string | null;
  connection: {
    id: string;
    status: "active" | "paused";
    allowedEvents: string[];
    metaLeadEnabled: boolean;
    metaPixelId: string | null;
    metaTestEventCode: string | null;
    lastReceivedAt: string | null;
    createdAt: string;
  } | null;
};

export type TrackingMonitor = {
  since: string;
  until: string;
  enabled: boolean;
  configured: boolean;
  status: string | null;
  lastReceivedAt: string | null;
  truncated: boolean;
  receipts: number;
  duplicateReceipts: number;
  latencyMs: { p50: number | null; p95: number | null };
  rejections: { reason: string; count: number }[];
  uniqueEvents: number;
  derivedKeys: number;
  byEnvironmentAndEvent: { environment: string; eventName: string; count: number }[];
  quality: {
    eventIdCoverage: number | null;
    sessionCoverage: number | null;
    utmCoverage: number | null;
    googleIdCoverage: number | null;
    metaIdCoverage: number | null;
  };
  contacts: { status: string; count: number }[];
  recentContacts: {
    refToken: string;
    messageAt: string;
    status: string;
    attempts: number;
    lastError: string | null;
    sentAt: string | null;
    environment: string | null;
    pagePath: string | null;
    clickTime: string | null;
  }[];
  recent: {
    eventName: string;
    environment: string;
    pagePath: string | null;
    eventTime: string;
    receivedAt: string;
    dedupeConfidence: string;
    receipts: number;
  }[];
};

export const environmentLabels: Record<string, string> = {
  site: "Site institucional",
  lp_online: "LP Online",
  lp_presencial: "LP Presencial",
  unknown: "Não identificado",
};

export const rejectionLabels: Record<string, string> = {
  auth: "Autenticação recusada",
  schema: "Fora do schema",
  timestamp: "Horário fora da janela",
  event_not_allowed: "Evento não permitido",
  rate_limited: "Limite por minuto",
};

export const contactStatusLabels: Record<string, string> = {
  pending: "Na fila",
  retrying: "Tentando de novo",
  sent: "Lead enviado",
  failed: "Falhou",
  skipped: "Não enviado",
  disabled: "Envio desligado",
  expired: "Expirado (mais de 7 dias)",
  no_click: "Sem clique com este token",
};

export function environmentLabel(key: string): string {
  return environmentLabels[key] ?? key;
}

export function coverage(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export function latency(value: number | null): string {
  if (value === null) return "—";
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;
}

export function dateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Rows per environment, one column per event name, for the matrix table. */
export function environmentMatrix(rows: TrackingMonitor["byEnvironmentAndEvent"]) {
  const eventNames = [...new Set(rows.map((row) => row.eventName))].sort();
  const environments = [...new Set(rows.map((row) => row.environment))].sort(
    (a, b) => Object.keys(environmentLabels).indexOf(a) - Object.keys(environmentLabels).indexOf(b),
  );
  const counts = new Map(rows.map((row) => [`${row.environment}|${row.eventName}`, row.count]));
  return {
    eventNames,
    rows: environments.map((environment) => ({
      environment,
      counts: eventNames.map((eventName) => counts.get(`${environment}|${eventName}`) ?? 0),
    })),
  };
}
