import { createVerify, generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptServiceAccountKey,
  encryptServiceAccountKey,
  parseServiceAccountKey,
} from "../../src/google-analytics/ga4-credential";
import { Ga4Client, signServiceAccountAssertion } from "../../src/google-analytics/ga4.client";
import {
  classifyEnvironment,
  comporvetEnvironmentPreset,
  ga4EnvironmentsSchema,
} from "../../src/google-analytics/ga4-environments";
import {
  buildCoreRequests,
  TEST_TRAFFIC_SOURCES,
  buildFunnelRequest,
  pageLocationPattern,
  parseFunnel,
  parseReport,
  previousPeriod,
} from "../../src/google-analytics/ga4-report";
import { GoogleAnalyticsService } from "../../src/google-analytics/google-analytics.service";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const serviceAccount = {
  type: "service_account" as const,
  client_email: "dash@projeto.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  private_key_id: "kid-1",
};
const env = {
  INBOUND_WEBHOOKS_ENABLED: "true",
  INBOUND_WEBHOOK_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  API_PUBLIC_URL: "https://api.example.com",
};

describe("ambientes Comporvet", () => {
  const cases: [string, string, string | null][] = [
    ["www.comporvet.com.br", "/", "site"],
    ["comporvet.com.br", "/blog/ansiedade", "site"],
    ["consultas.comporvet.com.br", "/", "lp_online"],
    ["consultas.comporvet.com.br", "/online", "lp_online"],
    ["consultas.comporvet.com.br", "/online/", "lp_online"],
    ["consultas.comporvet.com.br", "/presencial", "lp_presencial"],
    ["consultas.comporvet.com.br", "/presencial/", "lp_presencial"],
    ["consultas.comporvet.com.br", "/obrigado", null],
    ["blog.comporvet.com.br", "/", null],
  ];
  it.each(cases)("%s%s -> %s", (host, path, expected) => {
    expect(classifyEnvironment(comporvetEnvironmentPreset, host, path)).toBe(expected);
  });

  it("valida o preset e recusa chaves repetidas ou regex inválida", () => {
    expect(ga4EnvironmentsSchema.safeParse(comporvetEnvironmentPreset).success).toBe(true);
    expect(
      ga4EnvironmentsSchema.safeParse([comporvetEnvironmentPreset[0], comporvetEnvironmentPreset[0]]).success,
    ).toBe(false);
    expect(
      ga4EnvironmentsSchema.safeParse([{ key: "x", label: "X", hostPattern: "(" }]).success,
    ).toBe(false);
  });
});

describe("consultas GA4", () => {
  const filters = {
    current: { since: "2026-11-01", until: "2026-11-20" },
    previous: previousPeriod({ since: "2026-11-01", until: "2026-11-20" }),
    device: "mobile",
  };

  it("calcula o período anterior com o mesmo tamanho", () => {
    expect(filters.previous).toEqual({ since: "2026-10-12", until: "2026-10-31" });
  });

  it("aplica host, caminho e dispositivo em todas as consultas da LP Online", () => {
    const requests = buildCoreRequests(comporvetEnvironmentPreset[1]!, filters, { scrollDimensionAvailable: true });
    const serialized = JSON.stringify(requests.scroll);
    expect(serialized).toContain("^consultas\\\\.comporvet\\\\.com\\\\.br$");
    expect(serialized).toContain("^/(online/?)?$");
    expect(serialized).toContain('"deviceCategory"');
    expect(serialized).toContain('"scroll_depth"');
    expect(Object.keys(requests)).toEqual(["totals", "events", "daily", "dailyWhatsapp", "scroll"]);
  });

  it("exclui as sessões de teste por padrão e inclui quando pedido", () => {
    const excluded = JSON.stringify(buildCoreRequests(comporvetEnvironmentPreset[1]!, filters, { scrollDimensionAvailable: true }));
    expect(excluded).toContain('"notExpression"');
    expect(excluded).toContain("tagassistant.google.com");
    const included = JSON.stringify(
      buildCoreRequests(comporvetEnvironmentPreset[1]!, { ...filters, includeTestTraffic: true }, { scrollDimensionAvailable: true }),
    );
    expect(included).not.toContain("tagassistant.google.com");
    const funnel = JSON.stringify(buildFunnelRequest(comporvetEnvironmentPreset[0]!, { ...filters, device: undefined }, filters.current));
    expect(funnel).toContain('"notExpression"');
  });

  it("omite a consulta de rolagem sem a dimensão personalizada", () => {
    const requests = buildCoreRequests(comporvetEnvironmentPreset[0]!, filters, { scrollDimensionAvailable: false });
    expect(requests.scroll).toBeUndefined();
  });

  it("monta o funil fechado, indireto, filtrando page_location nas duas etapas", () => {
    const request = buildFunnelRequest(comporvetEnvironmentPreset[2]!, filters, filters.current) as any;
    expect(request.funnel.isOpenFunnel).toBe(false);
    expect(request.funnel.steps[1].isDirectlyFollowedBy).toBe(false);
    expect(JSON.stringify(request.funnel)).not.toMatch(/hostName|pagePath/);
    const events = request.funnel.steps.map((step: any) => step.filterExpression.funnelEventFilter);
    expect(events.map((event: any) => event.eventName)).toEqual(["page_view", "click_whatsapp"]);
    for (const event of events) {
      expect(event.funnelParameterFilterExpression.funnelParameterFilter).toEqual({
        eventParameterName: "page_location",
        stringFilter: { matchType: "FULL_REGEXP", value: pageLocationPattern(comporvetEnvironmentPreset[2]!) },
      });
    }
    expect(request.funnelBreakdown.breakdownDimension.name).toBe("deviceCategory");
    expect(request.dimensionFilter.andGroup.expressions).toEqual([
      { filter: { fieldName: "deviceCategory", stringFilter: { matchType: "EXACT", value: "mobile" } } },
      { notExpression: { filter: { fieldName: "sessionSource", inListFilter: { values: TEST_TRAFFIC_SOURCES } } } },
    ]);
  });

  const urls: [string, string, boolean][] = [
    ["site", "https://www.comporvet.com.br", true],
    ["site", "https://comporvet.com.br/blog/ansiedade?utm_source=x", true],
    ["site", "https://consultas.comporvet.com.br/", false],
    ["lp_online", "https://consultas.comporvet.com.br/", true],
    ["lp_online", "https://consultas.comporvet.com.br/online/?fbclid=1", true],
    ["lp_online", "https://consultas.comporvet.com.br/presencial/", false],
    ["lp_presencial", "https://consultas.comporvet.com.br/presencial?utm_medium=paid", true],
    ["lp_presencial", "https://consultas.comporvet.com.br/presencial/obrigado", false],
  ];
  it.each(urls)("page_location de %s: %s -> %s", (key, url, expected) => {
    const environment = comporvetEnvironmentPreset.find((item) => item.key === key)!;
    expect(new RegExp(pageLocationPattern(environment)).test(url)).toBe(expected);
  });

  it("lê a tabela do funil com total e detalhamento por dispositivo", () => {
    const result = parseFunnel({
      funnelTable: {
        dimensionHeaders: [{ name: "funnelStepName" }, { name: "deviceCategory" }],
        metricHeaders: [
          { name: "activeUsers" },
          { name: "funnelStepCompletionRate" },
          { name: "funnelStepAbandonments" },
          { name: "funnelStepAbandonmentRate" },
        ],
        rows: [
          { dimensionValues: [{ value: "1. Visualização" }, { value: "RESERVED_TOTAL" }], metricValues: [{ value: "12" }, { value: "0.25" }, { value: "9" }, { value: "0.75" }] },
          { dimensionValues: [{ value: "2. Clique no WhatsApp" }, { value: "RESERVED_TOTAL" }], metricValues: [{ value: "3" }, { value: "0" }, { value: "0" }, { value: "0" }] },
          { dimensionValues: [{ value: "1. Visualização" }, { value: "mobile" }], metricValues: [{ value: "10" }, { value: "0.2" }, { value: "8" }, { value: "0.8" }] },
          { dimensionValues: [{ value: "2. Clique no WhatsApp" }, { value: "mobile" }], metricValues: [{ value: "2" }, { value: "0" }, { value: "0" }, { value: "0" }] },
        ],
      },
    });
    expect(result.steps.map((step) => step.activeUsers)).toEqual([12, 3]);
    expect(result.progressionRate).toBe(25);
    expect(result.byDevice).toEqual([
      expect.objectContaining({ device: "mobile", progressionRate: 20 }),
    ]);
  });

  it("lê o funil com os cabeçalhos de métrica repetidos que o GA4 devolve", () => {
    const headers = ["activeUsers", "funnelStepCompletionRate", "funnelStepAbandonments", "funnelStepAbandonmentRate"];
    const metricHeaders = [...headers, ...headers].map((name) => ({ name, type: "TYPE_INTEGER" }));
    const values = (...items: string[]) => items.map((value) => ({ value }));
    const result = parseFunnel({
      funnelTable: {
        dimensionHeaders: [{ name: "funnelStepName" }],
        metricHeaders,
        rows: [
          { dimensionValues: [{ value: "1. Visualização" }], metricValues: values("12", "0.25", "9", "0.75") },
          { dimensionValues: [{ value: "2. Clique no WhatsApp" }], metricValues: values("3", "1", "0", "0") },
        ],
      },
    });
    expect(result.steps.map((step) => step.activeUsers)).toEqual([12, 3]);
    expect(result.steps[0]).toMatchObject({ completionRate: 0.25, abandonments: 9, abandonmentRate: 0.75 });
    expect(result.progressionRate).toBe(25);
  });

  it("separa os dois períodos pela dimensão dateRange", () => {
    const rows = parseReport({
      dimensionHeaders: [{ name: "dateRange" }],
      metricHeaders: [{ name: "sessions" }],
      rows: [
        { dimensionValues: [{ value: "current" }], metricValues: [{ value: "40" }] },
        { dimensionValues: [{ value: "previous" }], metricValues: [{ value: "30" }] },
      ],
    });
    expect(rows.map((row) => [row.dimensions.dateRange, row.metrics.sessions])).toEqual([
      ["current", 40],
      ["previous", 30],
    ]);
  });
});

describe("credencial da conta de serviço", () => {
  it("cifra amarrada ao workspace", () => {
    const encrypted = encryptServiceAccountKey(env, "ws_1", serviceAccount);
    expect(encrypted.credentialEncrypted).not.toContain("PRIVATE");
    expect(decryptServiceAccountKey(env, "ws_1", encrypted).client_email).toBe(serviceAccount.client_email);
    expect(() => decryptServiceAccountKey(env, "ws_2", encrypted)).toThrow();
  });

  it("recusa JSON que não é conta de serviço", () => {
    expect(parseServiceAccountKey('{"type":"authorized_user"}')).toBeNull();
    expect(parseServiceAccountKey("nao json")).toBeNull();
    expect(parseServiceAccountKey(JSON.stringify(serviceAccount))?.client_email).toBe(serviceAccount.client_email);
  });

  it("assina o JWT com RS256 e escopo somente leitura", () => {
    const assertion = signServiceAccountAssertion(serviceAccount, 1_000);
    const [header, claims, signature] = assertion.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toMatchObject({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      exp: 4_600,
    });
  });
});

type Call = { url: string; body: any };

function fakeGoogle(options: { funnelStatus?: number; dataStatus?: number } = {}) {
  const calls: Call[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body;
    calls.push({ url, body });
    if (url.includes("oauth2")) return json(200, { access_token: "tok", expires_in: 3600 });
    if (url.endsWith("/metadata")) {
      return json(200, { dimensions: [{ apiName: "customEvent:scroll_percent" }, { apiName: "customEvent:modalidade" }] });
    }
    if (url.includes(":runFunnelReport")) {
      if (options.funnelStatus) return json(options.funnelStatus, { error: { message: "funnel off" } });
      return json(200, {
        funnelTable: {
          dimensionHeaders: [{ name: "funnelStepName" }],
          metricHeaders: [{ name: "activeUsers" }],
          rows: [
            { dimensionValues: [{ value: "1. Visualização" }], metricValues: [{ value: "18" }] },
            { dimensionValues: [{ value: "2. Clique no WhatsApp" }], metricValues: [{ value: "1" }] },
          ],
        },
      });
    }
    if (url.includes(":batchRunReports")) {
      if (options.dataStatus) return json(options.dataStatus, { error: { message: "denied" } });
      const reports = body.requests.map((request: any) => {
        const dims = (request.dimensions ?? []).map((d: any) => d.name);
        if (dims[0] === "eventName") {
          return {
            dimensionHeaders: [{ name: "eventName" }, { name: "dateRange" }],
            metricHeaders: [{ name: "eventCount" }, { name: "totalUsers" }],
            rows: [
              { dimensionValues: [{ value: "page_view" }, { value: "current" }], metricValues: [{ value: "40" }, { value: "18" }] },
              { dimensionValues: [{ value: "click_whatsapp" }, { value: "current" }], metricValues: [{ value: "2" }, { value: "1" }] },
            ],
          };
        }
        if (dims.length === 0) {
          return {
            dimensionHeaders: [{ name: "dateRange" }],
            metricHeaders: request.metrics.map((m: any) => ({ name: m.name })),
            rows: [
              { dimensionValues: [{ value: "current" }], metricValues: request.metrics.map(() => ({ value: "20" })) },
            ],
          };
        }
        return { dimensionHeaders: dims.map((name: string) => ({ name })), metricHeaders: [], rows: [] };
      });
      return json(200, { reports });
    }
    if (url.includes(":runReport")) {
      return json(200, {
        dimensionHeaders: [{ name: "customEvent:scroll_percent" }],
        metricHeaders: [{ name: "totalUsers" }],
        rows: [
          { dimensionValues: [{ value: "50" }], metricValues: [{ value: "9" }] },
          { dimensionValues: [{ value: "90" }], metricValues: [{ value: "4" }] },
        ],
      });
    }
    return json(404, { error: { message: "unexpected" } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

function fakePrisma() {
  let row: any = null;
  return {
    googleAnalyticsConnection: {
      findUnique: async () => row,
      create: async ({ data }: any) => (row = { ...data, id: "c1", updatedAt: new Date(1), lastValidatedAt: null }),
      update: async ({ data }: any) => (row = { ...row, ...data, updatedAt: new Date(row.updatedAt.getTime() + 1) }),
      updateMany: async ({ data }: any) => {
        row = row && { ...row, ...data };
        return { count: row ? 1 : 0 };
      },
      deleteMany: async () => {
        row = null;
        return { count: 1 };
      },
    },
    get row() {
      return row;
    },
  };
}

async function connectedService(options?: Parameters<typeof fakeGoogle>[0]) {
  const google = fakeGoogle(options);
  const prisma = fakePrisma();
  const service = new GoogleAnalyticsService(prisma as any, env, google.fetchFn);
  await service.saveConnection("ws_1", "u1", {
    propertyId: "properties/123456789",
    serviceAccountJson: JSON.stringify(serviceAccount),
    environments: comporvetEnvironmentPreset,
    expectedMeasurementIds: ["g-xm10srkv8d", "G-D3GRCTSMNW"],
  });
  return { service, prisma, google };
}

describe("GoogleAnalyticsService", () => {
  it("não devolve a chave e normaliza propriedade e IDs de medição", async () => {
    const { service, prisma } = await connectedService();
    const connection = await service.getConnection("ws_1");
    expect(JSON.stringify(connection)).not.toContain("PRIVATE KEY");
    expect(connection).toMatchObject({ propertyId: "123456789", expectedMeasurementIds: ["G-XM10SRKV8D", "G-D3GRCTSMNW"] });
    expect(prisma.row.credentialEncrypted).toBeTruthy();
  });

  it("recusa o ID de medição no lugar do ID da propriedade", async () => {
    const service = new GoogleAnalyticsService(fakePrisma() as any, env, fakeGoogle().fetchFn);
    await expect(
      service.saveConnection("ws_1", "u1", {
        propertyId: "G-XM10SRKV8D",
        serviceAccountJson: JSON.stringify(serviceAccount),
        environments: comporvetEnvironmentPreset,
        expectedMeasurementIds: [],
      }),
    ).rejects.toThrow(/numérico/);
  });

  it("monta os três ambientes com funil, rolagem e cache", async () => {
    const { service, google } = await connectedService();
    const report: any = await service.report("ws_1", { since: "2026-11-01", until: "2026-11-03" });
    expect(report.status).toBe("ok");
    expect(report.environments.map((environment: any) => environment.key)).toEqual(["site", "lp_online", "lp_presencial"]);
    const site = report.environments[0];
    expect(site.core.status).toBe("ok");
    expect(site.core.data.daily).toHaveLength(3);
    expect(site.core.data.totals.current.averageEngagementTimePerSession).toBe(1);
    const totalsRequest = google.calls.find((call) => call.url.includes(":batchRunReports"))!.body.requests[0];
    expect(totalsRequest.metrics.map((metric: any) => metric.name)).not.toContain("averageEngagementTimePerSession");
    expect(site.core.data.events.current.click_whatsapp).toEqual({ eventCount: 2, totalUsers: 1 });
    expect(site.funnel).toMatchObject({ status: "ok", method: "funnel_report" });
    expect(site.funnel.data.progressionRate).toBeCloseTo(5.555, 2);
    expect(site.scrollUsers.data.find((item: any) => item.percent === 50).totalUsers).toBe(9);
    expect(google.calls.some((call) => call.url.includes("v1alpha") && call.url.includes("properties/123456789:runFunnelReport"))).toBe(true);

    const before = google.calls.length;
    await service.report("ws_1", { since: "2026-11-01", until: "2026-11-03" });
    expect(google.calls.length).toBe(before);
    await service.report("ws_1", { since: "2026-11-01", until: "2026-11-03", refresh: true });
    expect(google.calls.length).toBeGreaterThan(before);
  });

  it("identifica a aproximação quando o relatório de funil falha", async () => {
    const { service } = await connectedService({ funnelStatus: 404 });
    const report: any = await service.report("ws_1", { since: "2026-11-01", until: "2026-11-01" });
    const funnel = report.environments[1].funnel;
    expect(funnel.method).toBe("event_ratio_fallback");
    expect(funnel.message).toMatch(/sem exigir sequência/);
  });

  it("mostra falta de permissão em vez de zeros", async () => {
    const { service, prisma } = await connectedService({ dataStatus: 403 });
    const report: any = await service.report("ws_1", { since: "2026-11-01", until: "2026-11-01" });
    expect(report.environments[0].core).toMatchObject({ status: "unauthorized", data: null });
    expect(prisma.row.lastErrorKind).toBe("unauthorized");
  });

  it("diagnostica o funil com cada forma de filtrar a página, sem credenciais", async () => {
    const { service, google } = await connectedService();
    const result: any = await service.funnelDiagnostics("ws_1", { since: "2026-11-01", until: "2026-11-20" });
    expect(result.environments).toHaveLength(3);
    const variants = result.environments[1].variants;
    expect(variants.map((variant: any) => [variant.strategy, variant.breakdown])).toEqual([
      ["param_page_location", false],
      ["field_pageLocation", false],
      ["field_hostName", false],
      ["none", false],
      ["param_page_location", true],
    ]);
    expect(variants[0]).toMatchObject({ status: "ok", steps: [18, 1] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
    const funnelBodies = google.calls.filter((call) => call.url.includes(":runFunnelReport")).map((call) => call.body);
    expect(funnelBodies.some((body) => JSON.stringify(body.funnel).includes('"fieldName":"pageLocation"'))).toBe(true);
    expect(funnelBodies.some((body) => !JSON.stringify(body.funnel).includes("page_location") && !JSON.stringify(body.funnel).includes("fieldName"))).toBe(true);
  });

  it("sem conexão responde configuração incompleta", async () => {
    const service = new GoogleAnalyticsService(fakePrisma() as any, env, fakeGoogle().fetchFn);
    await expect(service.report("ws_1", {})).resolves.toMatchObject({ status: "incomplete_config" });
  });
});

describe("Ga4Client", () => {
  it("limita as consultas simultâneas à mesma propriedade", async () => {
    let active = 0;
    let peak = 0;
    const fetchFn = (async (input: string | URL) => {
      if (String(input).includes("oauth2")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return new Response(JSON.stringify({ dimensions: [] }), { status: 200 });
    }) as typeof fetch;
    const client = new Ga4Client(serviceAccount, fetchFn);
    await Promise.all(Array.from({ length: 12 }, () => client.getMetadata("1")));
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("reaproveita o token até perto de expirar", async () => {
    const google = fakeGoogle();
    let now = 0;
    const client = new Ga4Client(serviceAccount, google.fetchFn, () => now);
    await client.getMetadata("1");
    await client.getMetadata("1");
    now = 3_550_000;
    await client.getMetadata("1");
    expect(google.calls.filter((call) => call.url.includes("oauth2"))).toHaveLength(2);
  });
});
