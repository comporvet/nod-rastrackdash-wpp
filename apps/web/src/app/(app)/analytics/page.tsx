import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { getCurrentWorkspace } from "../../../lib/current-workspace";
import { isApiRequestError, serverApiFetch } from "../../../lib/server-api";
import { Ga4LineChart } from "./ga4-line-chart";
import {
  comparisonCsv,
  comparisonRows,
  formatMetric,
  variation,
  type ComparisonRow,
} from "./ga4-metrics";
import {
  environmentColor,
  sectionStatusCopy,
  type Ga4AcquisitionRow,
  type Ga4EnvironmentReport,
  type Ga4Funnel,
  type Ga4Report,
  type Ga4Section,
} from "./ga4-types";

type SearchParams = Record<string, string | string[] | undefined>;

const deviceLabels: Record<string, string> = { desktop: "Computador", mobile: "Celular", tablet: "Tablet" };
const milestones = [10, 25, 50, 75, 90, 100];

function param(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  const single = Array.isArray(value) ? value[0] : value;
  return single?.trim() || undefined;
}

function formatDate(date: string) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

function integer(value: number) {
  return Math.round(value).toLocaleString("pt-BR");
}

function percent(value: number | null) {
  return value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

async function loadReport(query: URLSearchParams): Promise<{ report: Ga4Report | null; error: string | null }> {
  try {
    return { report: await serverApiFetch<Ga4Report>(`/google-analytics/report?${query.toString()}`), error: null };
  } catch (error) {
    return { report: null, error: isApiRequestError(error) ? error.message : "API indisponível" };
  }
}

function StatusChip({ status }: { status: keyof typeof sectionStatusCopy }) {
  const copy = sectionStatusCopy[status];
  return <span className={`status-chip ${copy.tone}`.trim()}>{copy.label}</span>;
}

function SectionGate<T>({ section, children }: { section: Ga4Section<T>; children: (data: T) => ReactNode }) {
  if (section.data && (section.status === "ok" || section.status === "no_data")) {
    return (
      <>
        {section.status === "no_data" ? (
          <p className="ga4-note">Nenhum registro no período para este ambiente.</p>
        ) : null}
        {children(section.data)}
      </>
    );
  }
  return (
    <div className="ga4-section-state" role="status">
      <StatusChip status={section.status} />
      {section.message ? <span>{section.message}</span> : null}
    </div>
  );
}

function VariationBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const sign = value > 0 ? "+" : "";
  return (
    <small className={`ga4-variation ${value > 0 ? "up" : value < 0 ? "down" : ""}`}>
      {sign}
      {value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. anterior
    </small>
  );
}

function ComparisonTable({ rows, reports }: { rows: ComparisonRow[]; reports: Ga4EnvironmentReport[] }) {
  return (
    <div className="table-wrap ga4-table-wrap">
      <table className="ga4-table">
        <thead>
          <tr>
            <th scope="col">Indicador</th>
            {reports.map((report) => (
              <th scope="col" key={report.key}>
                {report.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" title={row.hint}>
                {row.label}
                <small>{row.source}</small>
              </th>
              {reports.map((report) => {
                const value = row.values[report.key] ?? { current: null, previous: null };
                return (
                  <td key={report.key}>
                    <strong>{formatMetric(value.current, row.format)}</strong>
                    <VariationBadge value={variation(value)} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KpiCards({ report, color }: { report: Ga4EnvironmentReport; color: string }) {
  const totals = report.core.data?.totals;
  const events = report.core.data?.events;
  const items = [
    { label: "Usuários", current: totals?.current.totalUsers, previous: totals?.previous?.totalUsers },
    { label: "Sessões", current: totals?.current.sessions, previous: totals?.previous?.sessions },
    { label: "Visualizações", current: totals?.current.screenPageViews, previous: totals?.previous?.screenPageViews },
    {
      label: "Cliques no WhatsApp",
      current: events?.current.click_whatsapp?.eventCount,
      previous: events?.previous?.click_whatsapp?.eventCount,
    },
  ];
  return (
    <article className="ga4-kpi-card" style={{ "--ga4-env": color } as CSSProperties}>
      <header>
        <i aria-hidden="true" />
        <strong>{report.label}</strong>
        <StatusChip status={report.core.status} />
      </header>
      {report.core.data ? (
        <dl>
          {items.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.current === undefined ? "—" : integer(item.current)}</dd>
              <VariationBadge
                value={variation({ current: item.current ?? null, previous: item.previous ?? null })}
              />
            </div>
          ))}
          <div>
            <dt>Progressão do funil</dt>
            <dd>{percent(report.funnel.data?.progressionRate ?? null)}</dd>
          </div>
        </dl>
      ) : (
        <p className="ga4-note">{report.core.message ?? "Sem dados"}</p>
      )}
    </article>
  );
}

function HorizontalBars({
  items,
  format = integer,
}: {
  items: { key: string; label: string; value: number; color: string; detail?: string }[];
  format?: (value: number) => string;
}) {
  const maximum = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="ga4-bars">
      {items.map((item) => (
        <li key={item.key} title={`${item.label}: ${format(item.value)}${item.detail ? ` (${item.detail})` : ""}`}>
          <span className="ga4-bar-label">{item.label}</span>
          <span className="ga4-bar-track">
            <span
              className="ga4-bar-fill"
              style={{ width: `${(item.value / maximum) * 100}%`, background: item.color }}
            />
          </span>
          <span className="ga4-bar-value">
            {format(item.value)}
            {item.detail ? <small>{item.detail}</small> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FunnelBlock({ report, color }: { report: Ga4EnvironmentReport; color: string }) {
  return (
    <article className="ga4-funnel" style={{ "--ga4-env": color } as CSSProperties}>
      <header>
        <strong>{report.label}</strong>
        <span className="micro-label">Visualização → Clique no WhatsApp</span>
      </header>
      <FunnelBody funnel={report.funnel} previous={report.previousFunnel} color={color} />
    </article>
  );
}

function FunnelBody({ funnel, previous, color }: { funnel: Ga4Funnel; previous: Ga4Funnel | null; color: string }) {
  return (
    <SectionGate section={funnel}>
      {(data) => {
        const base = data.steps[0]?.activeUsers ?? 0;
        return (
          <>
            {funnel.method === "event_ratio_fallback" ? (
              <p className="ga4-note warn">Aproximação, não é funil sequencial. {funnel.message}</p>
            ) : (
              <p className="ga4-note">Fonte: runFunnelReport do GA4 (funil sequencial).</p>
            )}
            <div className="ga4-funnel-steps">
              {data.steps.map((step, index) => (
                <div key={step.name} className="ga4-funnel-step">
                  <span className="ga4-funnel-index">{index + 1}</span>
                  <span className="ga4-funnel-name">{step.name}</span>
                  <span className="ga4-bar-track">
                    <span
                      className="ga4-bar-fill"
                      style={{ width: `${base ? (step.activeUsers / base) * 100 : 0}%`, background: color }}
                    />
                  </span>
                  <strong>{integer(step.activeUsers)}</strong>
                </div>
              ))}
            </div>
            <dl className="ga4-funnel-summary">
              <div>
                <dt>Taxa de progressão</dt>
                <dd>{percent(data.progressionRate)}</dd>
              </div>
              <div>
                <dt>Abandono entre as etapas</dt>
                <dd>
                  {data.steps[0]?.abandonments !== null && data.steps[0]?.abandonments !== undefined
                    ? `${integer(data.steps[0].abandonments)} usuários`
                    : "—"}
                </dd>
              </div>
              {previous ? (
                <div>
                  <dt>Período anterior</dt>
                  <dd>{percent(previous.data?.progressionRate ?? null)}</dd>
                </div>
              ) : null}
            </dl>
            {data.byDevice.length ? (
              <div className="table-wrap ga4-table-wrap">
                <table className="ga4-table compact">
                  <thead>
                    <tr>
                      <th scope="col">Dispositivo</th>
                      <th scope="col">Etapa 1</th>
                      <th scope="col">Etapa 2</th>
                      <th scope="col">Progressão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byDevice.map((device) => (
                      <tr key={device.device}>
                        <th scope="row">{deviceLabels[device.device] ?? device.device}</th>
                        <td>{integer(device.steps[0]?.activeUsers ?? 0)}</td>
                        <td>{integer(device.steps[1]?.activeUsers ?? 0)}</td>
                        <td>{percent(device.progressionRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        );
      }}
    </SectionGate>
  );
}

function ScrollBlock({ report, color }: { report: Ga4EnvironmentReport; color: string }) {
  const viewUsers = report.core.data?.events.current.page_view?.totalUsers ?? 0;
  return (
    <article className="ga4-panel-block">
      <header>
        <strong>{report.label}</strong>
        <span className="micro-label">Usuários que alcançaram pelo menos X% de rolagem</span>
      </header>
      <SectionGate section={report.scrollUsers}>
        {(data) => (
          <HorizontalBars
            items={data.map((item) => ({
              key: String(item.percent),
              label: `≥ ${item.percent}%`,
              value: item.totalUsers,
              color,
              detail: viewUsers ? `${percent((item.totalUsers / viewUsers) * 100)} de ${integer(viewUsers)} com page_view` : undefined,
            }))}
          />
        )}
      </SectionGate>
      <SectionGate section={report.scroll}>
        {(data) =>
          data.byPage.length ? (
            <details className="ga4-details">
              <summary>Tabela por página e marco ({data.byPage.length} linhas)</summary>
              {data.otherValues.length ? (
                <p className="ga4-note">
                  Valores fora dos marcos configurados: {data.otherValues.join(", ")}.
                </p>
              ) : null}
              <div className="table-wrap ga4-table-wrap">
                <table className="ga4-table compact">
                  <thead>
                    <tr>
                      <th scope="col">Página</th>
                      <th scope="col">Marco</th>
                      <th scope="col">Usuários</th>
                      <th scope="col">Eventos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.byPage]
                      .sort((a, b) => a.pagePath.localeCompare(b.pagePath) || a.percent - b.percent)
                      .map((row) => (
                        <tr key={`${row.pagePath}-${row.percent}`}>
                          <th scope="row">{row.pagePath || "(sem caminho)"}</th>
                          <td>{row.percent}%</td>
                          <td>{integer(row.totalUsers)}</td>
                          <td>{integer(row.eventCount)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null
        }
      </SectionGate>
    </article>
  );
}

function AcquisitionTable({ title, rows, shareOf }: { title: string; rows: Ga4AcquisitionRow[]; shareOf?: number }) {
  if (!rows.length) return null;
  return (
    <div className="ga4-acquisition-table">
      <h4>{title}</h4>
      <div className="table-wrap ga4-table-wrap">
        <table className="ga4-table compact">
          <thead>
            <tr>
              <th scope="col">{title}</th>
              <th scope="col">Sessões</th>
              {shareOf ? <th scope="col">Participação</th> : null}
              <th scope="col">Usuários ativos</th>
              <th scope="col">Sessões engajadas</th>
              <th scope="col">Visualizações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.value}>
                <th scope="row">{deviceLabels[row.value] ?? (row.value || "(não definido)")}</th>
                <td>{integer(row.sessions)}</td>
                {shareOf ? <td>{percent((row.sessions / shareOf) * 100)}</td> : null}
                <td>{integer(row.activeUsers)}</td>
                <td>{integer(row.engagedSessions)}</td>
                <td>{integer(row.screenPageViews)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AcquisitionBlock({ report, color }: { report: Ga4EnvironmentReport; color: string }) {
  return (
    <article className="ga4-panel-block">
      <header>
        <strong>{report.label}</strong>
      </header>
      <SectionGate section={report.acquisition}>
        {(data) => {
          const channelTotal = data.channel.reduce((sum, row) => sum + row.sessions, 0);
          return (
            <>
              <h4>Participação dos canais nas sessões</h4>
              <HorizontalBars
                items={data.channel.map((row) => ({
                  key: row.value,
                  label: row.value || "(não definido)",
                  value: row.sessions,
                  color,
                  detail: channelTotal ? percent((row.sessions / channelTotal) * 100) : undefined,
                }))}
              />
              <AcquisitionTable title="Origem / mídia" rows={data.sourceMedium} />
              <AcquisitionTable title="Campanha" rows={data.campaign} />
              <AcquisitionTable title="Dispositivo" rows={data.device} shareOf={channelTotal} />
            </>
          );
        }}
      </SectionGate>
    </article>
  );
}

function FilterForm({ params, environments }: { params: SearchParams; environments: { key: string; label: string }[] }) {
  return (
    <form className="surface-panel ga4-filters" action="/analytics">
      <label className="filter-field">
        <span>Início</span>
        <input type="date" name="since" defaultValue={param(params, "since")} />
      </label>
      <label className="filter-field">
        <span>Fim</span>
        <input type="date" name="until" defaultValue={param(params, "until")} />
      </label>
      <label className="filter-field">
        <span>Ambiente</span>
        <select name="env" defaultValue={param(params, "env") ?? ""}>
          <option value="">Todos</option>
          {environments.map((environment) => (
            <option key={environment.key} value={environment.key}>
              {environment.label}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span>Dispositivo</span>
        <select name="device" defaultValue={param(params, "device") ?? ""}>
          <option value="">Todos</option>
          {Object.entries(deviceLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span>Origem / mídia</span>
        <input name="sourceMedium" placeholder="ex.: facebook / paid" defaultValue={param(params, "sourceMedium")} />
      </label>
      <label className="filter-field">
        <span>Campanha</span>
        <input name="campaign" placeholder="nome exato" defaultValue={param(params, "campaign")} />
      </label>
      <label className="ga4-checkbox">
        <input type="checkbox" name="compare" value="1" defaultChecked={param(params, "compare") === "1"} />
        <span>Comparar com o período anterior</span>
      </label>
      <label className="ga4-checkbox">
        <input type="checkbox" name="includeTests" value="1" defaultChecked={param(params, "includeTests") === "1"} />
        <span>Incluir sessões de teste</span>
      </label>
      <button className="button primary" type="submit">
        Aplicar
      </button>
    </form>
  );
}

function Panel({ eyebrow, title, description, children }: { eyebrow: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="surface-panel ga4-panel">
      <header className="ga4-panel-header">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = searchParams ? await searchParams : {};
  const workspace = await getCurrentWorkspace();
  const canConfigure = workspace.permissions.canManageIntegrations;

  const query = new URLSearchParams();
  for (const name of ["since", "until", "device", "sourceMedium", "campaign", "compare", "includeTests", "refresh"]) {
    const value = param(params, name);
    if (value) query.set(name, value);
  }
  const { report, error } = await loadReport(query);
  const refreshQuery = new URLSearchParams(query);
  refreshQuery.set("refresh", "1");
  const selectedEnv = param(params, "env");

  const allReports = report?.environments ?? [];
  const colorOf = (key: string) => environmentColor(allReports.findIndex((item) => item.key === key));
  const reports = selectedEnv ? allReports.filter((item) => item.key === selectedEnv) : allReports;
  const rows = comparisonRows(reports);
  const period = report?.filters
    ? `${formatDate(report.filters.current.since)} a ${formatDate(report.filters.current.until)}`
    : "";
  const csv = comparisonCsv(rows, reports, period);
  const dates = reports[0]?.core.data?.daily.map((point) => point.date) ?? [];
  const ready = report?.status === "ok" && reports.length > 0;

  return (
    <section className="page-stack page-wide ga4-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Google Analytics 4</span>
          <h1>Site e Landing Pages</h1>
          <p>
            Tráfego, engajamento, rolagem e progressão até o WhatsApp, separados por ambiente pela URL da página.
            {report?.propertyId ? ` Propriedade ${report.propertyId}.` : ""}
          </p>
        </div>
        <div className="header-actions">
          {error ? <span className="status-chip bad">API indisponível</span> : report ? <StatusChip status={report.status} /> : null}
          {ready ? (
            <Link className="button ghost" href={`/analytics?${refreshQuery.toString()}`} prefetch={false}>
              Atualizar agora
            </Link>
          ) : null}
          <Link className="button ghost" href="/analytics/origins">
            Origem dos leads
          </Link>
          <Link className="button ghost" href="/analytics/tracking">
            Tracking Monitor
          </Link>
          {canConfigure ? (
            <Link className="button ghost" href="/analytics/settings">
              Configurar GA4
            </Link>
          ) : null}
        </div>
      </header>

      {error || !ready ? (
        <section className="surface-panel ga4-section-state" role="status">
          <strong>{error ? "Não foi possível consultar o GA4" : sectionStatusCopy[report?.status ?? "incomplete_config"].label}</strong>
          <span>{error ?? report?.message ?? "Sem ambientes configurados."}</span>
          {canConfigure && report?.status !== "ok" ? (
            <Link className="button primary" href="/analytics/settings">
              Abrir configuração do GA4
            </Link>
          ) : null}
        </section>
      ) : (
        <>
          <FilterForm params={params} environments={allReports} />
          <p className="ga4-note">
            Período {period}
            {report.filters?.previous
              ? `, comparado a ${formatDate(report.filters.previous.since)} a ${formatDate(report.filters.previous.until)}`
              : ""}
            . Datas no fuso da propriedade GA4. Dados de até 48 horas podem estar em processamento.
            {report.testTrafficSources?.length
              ? report.filters?.includeTestTraffic
                ? ` Sessões de teste incluídas (${report.testTrafficSources.join(", ")}).`
                : ` Sessões de teste excluídas: origem ${report.testTrafficSources.join(" ou ")}.`
              : ""}
            {report.generatedAt ? ` Consultado em ${new Date(report.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : ""}
          </p>

          <div className="ga4-kpi-grid">
            {reports.map((item) => (
              <KpiCards key={item.key} report={item} color={colorOf(item.key)} />
            ))}
          </div>

          <Panel
            eyebrow="Comparação de ambientes"
            title="Indicadores lado a lado"
            description="Mesma metodologia nos três ambientes. Passe o mouse no indicador para ver a fórmula."
          >
            <ComparisonTable rows={rows} reports={reports} />
            <a
              className="button ghost ga4-export"
              download={`ga4-comparacao-${report.filters?.current.since}-${report.filters?.current.until}.csv`}
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${csv}`)}`}
            >
              Exportar CSV
            </a>
            <div className="ga4-bar-groups">
              {[
                { key: "sessions", label: "Sessões" },
                { key: "screenPageViews", label: "Visualizações" },
                { key: "whatsappEvents", label: "Cliques no WhatsApp (eventos)" },
              ].map((metric) => (
                <div key={metric.key}>
                  <h4>{metric.label}</h4>
                  <HorizontalBars
                    items={reports.map((item) => ({
                      key: item.key,
                      label: item.label,
                      value: rows.find((row) => row.key === metric.key)?.values[item.key]?.current ?? 0,
                      color: colorOf(item.key),
                    }))}
                  />
                </div>
              ))}
            </div>
          </Panel>

          <Panel eyebrow="Série temporal" title="Evolução diária">
            <div className="ga4-chart-grid">
              <Ga4LineChart
                title="Visualizações por dia"
                dates={dates}
                series={reports.map((item) => ({
                  key: item.key,
                  label: item.label,
                  color: colorOf(item.key),
                  values: item.core.data?.daily.map((point) => point.screenPageViews) ?? [],
                }))}
              />
              <Ga4LineChart
                title="Cliques no WhatsApp por dia (eventos click_whatsapp)"
                dates={dates}
                series={reports.map((item) => ({
                  key: item.key,
                  label: item.label,
                  color: colorOf(item.key),
                  values: item.core.data?.daily.map((point) => point.whatsappClicks) ?? [],
                }))}
              />
            </div>
          </Panel>

          <Panel
            eyebrow="Funis de conversão"
            title="Visualização → Clique no WhatsApp"
            description="Funil fechado do GA4 (runFunnelReport), com sequência indireta: outros eventos podem ocorrer entre as etapas. Conta usuários que completaram as etapas na ordem. Clique no WhatsApp não é mensagem enviada nem consulta agendada."
          >
            <div className="ga4-funnel-grid">
              {reports.map((item) => (
                <FunnelBlock key={item.key} report={item} color={colorOf(item.key)} />
              ))}
            </div>
          </Panel>

          <Panel
            eyebrow="Engajamento e rolagem"
            title="Alcance da profundidade de rolagem"
            description={
              <>
                Evento scroll_depth nos marcos {milestones.join(", ")}%. Cada barra conta usuários distintos que alcançaram pelo menos aquele marco; os marcos não se somam e não indicam o ponto exato de abandono. O percentual usa como base os usuários com page_view no mesmo ambiente.
                {report.customDimensions?.["customEvent:scroll_percent"] === false
                  ? " A dimensão customEvent:scroll_percent não está disponível na propriedade."
                  : ""}
              </>
            }
          >
            <div className="ga4-env-grid">
              {reports.map((item) => (
                <ScrollBlock key={item.key} report={item} color={colorOf(item.key)} />
              ))}
            </div>
          </Panel>

          <Panel
            eyebrow="Aquisição de tráfego"
            title="Origem, canal, campanha e dispositivo"
            description="Sessões com eventos no ambiente. Origem/mídia e campanha são da sessão (sessionSourceMedium, sessionCampaignName)."
          >
            <div className="ga4-env-grid">
              {reports.map((item) => (
                <AcquisitionBlock key={item.key} report={item} color={colorOf(item.key)} />
              ))}
            </div>
          </Panel>

          <Panel
            eyebrow="Plataformas de anúncios"
            title="Fontes que não se somam"
            description="Clique no WhatsApp (GA4), evento Contact do Pixel e conversão atribuída pela Meta medem coisas diferentes, com atribuições próprias. Nunca some essas colunas."
          >
            <ul className="ga4-source-list">
              <li>
                <strong>Meta Ads</strong>
                <span>Investimento, alcance, cliques e resultados por campanha, conjunto e anúncio já vêm da integração Meta existente.</span>
                <Link href="/reports">Abrir Relatórios</Link>
              </li>
              <li>
                <strong>Google Ads</strong>
                <span>Pendente de autorização: Customer ID, developer token e ações de conversão ainda não configurados.</span>
              </li>
            </ul>
          </Panel>
        </>
      )}
    </section>
  );
}
