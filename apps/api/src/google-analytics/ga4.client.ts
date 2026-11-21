import { createSign } from "node:crypto";
import type { RuntimeFetch } from "../common/runtime/runtime.module";
import type { ServiceAccountKey } from "./ga4-credential";

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const DATA_API = "https://analyticsdata.googleapis.com";
const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 30_000;

export type Ga4ErrorKind =
  | "unauthorized"
  | "invalid_request"
  | "quota"
  | "not_found"
  | "temporary";

export class Ga4ApiError extends Error {
  constructor(
    readonly kind: Ga4ErrorKind,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "Ga4ApiError";
  }
}

function classify(status: number): Ga4ErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "quota";
  if (status === 404) return "not_found";
  if (status >= 400 && status < 500) return "invalid_request";
  return "temporary";
}

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

export function signServiceAccountAssertion(key: ServiceAccountKey, nowSeconds: number): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: key.private_key_id }));
  const claims = base64Url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: key.token_uri ?? TOKEN_URI,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${base64Url(signer.sign(key.private_key))}`;
}

type CachedToken = { value: string; expiresAt: number };

// The Data API allows 10 concurrent requests per property; stay well below it.
const MAX_CONCURRENT_REQUESTS = 4;

export class Ga4Client {
  private token: CachedToken | null = null;
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly key: ServiceAccountKey,
    private readonly fetchFn: RuntimeFetch,
    private readonly now: () => number = Date.now,
  ) {}

  get serviceAccountEmail(): string {
    return this.key.client_email;
  }

  runReport(propertyId: string, body: unknown) {
    return this.call<Ga4ReportResponse>("POST", `${DATA_API}/v1beta/properties/${propertyId}:runReport`, body);
  }

  batchRunReports(propertyId: string, requests: unknown[]) {
    return this.call<{ reports?: Ga4ReportResponse[] }>(
      "POST",
      `${DATA_API}/v1beta/properties/${propertyId}:batchRunReports`,
      { requests },
    );
  }

  runFunnelReport(propertyId: string, body: unknown) {
    return this.call<Ga4FunnelResponse>("POST", `${DATA_API}/v1alpha/properties/${propertyId}:runFunnelReport`, body);
  }

  getMetadata(propertyId: string) {
    return this.call<{ dimensions?: { apiName: string; uiName?: string }[]; metrics?: { apiName: string }[] }>(
      "GET",
      `${DATA_API}/v1beta/properties/${propertyId}/metadata`,
    );
  }

  listAccountSummaries() {
    return this.call<{
      accountSummaries?: {
        account: string;
        displayName: string;
        propertySummaries?: { property: string; displayName: string }[];
      }[];
    }>("GET", `${ADMIN_API}/accountSummaries?pageSize=200`);
  }

  getProperty(propertyId: string) {
    return this.call<{ name: string; displayName: string; timeZone?: string; currencyCode?: string }>(
      "GET",
      `${ADMIN_API}/properties/${propertyId}`,
    );
  }

  listDataStreams(propertyId: string) {
    return this.call<{
      dataStreams?: {
        name: string;
        type: string;
        displayName: string;
        webStreamData?: { measurementId?: string; defaultUri?: string };
      }[];
    }>("GET", `${ADMIN_API}/properties/${propertyId}/dataStreams?pageSize=200`);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const assertion = signServiceAccountAssertion(this.key, Math.floor(this.now() / 1000));
    const response = await this.fetchFn(this.key.token_uri ?? TOKEN_URI, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Ga4ApiError(
        response.status >= 500 ? "temporary" : "unauthorized",
        response.status,
        "A conta de serviço não obteve token do Google",
      );
    }
    const payload = (await response.json()) as { access_token: string; expires_in?: number };
    this.token = {
      value: payload.access_token,
      expiresAt: this.now() + (payload.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  private async call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
    if (this.active >= MAX_CONCURRENT_REQUESTS) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await this.send<T>(method, url, body);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }

  private async send<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Ga4ApiError("temporary", 0, "Falha de rede ao consultar o Google Analytics");
    }
    if (!response.ok) {
      const detail = await response
        .json()
        .then((payload: { error?: { message?: string } }) => payload.error?.message)
        .catch(() => undefined);
      throw new Ga4ApiError(classify(response.status), response.status, (detail ?? `HTTP ${response.status}`).slice(0, 500));
    }
    return (await response.json()) as T;
  }
}

export type Ga4ReportResponse = {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string; type?: string }[];
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
  rowCount?: number;
  metadata?: { dataLossFromOtherRow?: boolean; samplingMetadatas?: unknown[]; timeZone?: string };
};

export type Ga4FunnelResponse = {
  funnelTable?: Ga4ReportResponse;
  funnelVisualization?: Ga4ReportResponse;
  kind?: string;
};
