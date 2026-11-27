import Link from "next/link";
import { getCurrentWorkspace } from "../../../../lib/current-workspace";
import { isApiRequestError, serverApiFetch } from "../../../../lib/server-api";
import { dateTime } from "../tracking/tracking-types";
import {
  channelCounts,
  channelLabel,
  entryLabels,
  filterRows,
  organicChannels,
  paidChannels,
  share,
  touchText,
  type LeadOriginReport,
} from "./origins-types";

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function filterHref(base: URLSearchParams, extra: Record<string, string | undefined>) {
  const query = new URLSearchParams(base);
  query.delete("group");
  query.delete("channel");
  for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value);
  return `/analytics/origins?${query.toString()}`;
}

export default async function LeadOriginsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = searchParams ? await searchParams : {};
  const workspace = await getCurrentWorkspace();
  if (!workspace.permissions.canViewReports) {
    return (
      <section className="page-stack page-standard">
        <p className="ga4-section-state">Sem permissão para ver relatórios.</p>
      </section>
    );
  }
  const since = single(params.since);
  const until = single(params.until);
  const group = single(params.group);
  const channel = single(params.channel);
  const period = new URLSearchParams();
  if (since) period.set("since", since);
  if (until) period.set("until", until);

  let report: LeadOriginReport | null = null;
  let error: string | null = null;
  try {
    report = await serverApiFetch<LeadOriginReport>(`/tracking/lead-origins?${period.toString()}`);
  } catch (caught) {
    error = isApiRequestError(caught) ? caught.message : "API indisponível";
  }
  const rows = report ? filterRows(report.rows, { group, channel }) : [];

  return (
    <section className="page-stack page-wide ga4-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Atribuição</span>
          <h1>Origem dos leads</h1>
          <p>
            Tráfego pago (Google Ads e Meta Ads) ou orgânico de cada lead, recuperado pelas visitas anteriores do mesmo
            navegador.
          </p>
        </div>
        <div className="header-actions">
          <Link className="button ghost" href="/analytics/tracking">
            Tracking Monitor
          </Link>
          <Link className="button ghost" href="/analytics">
            Site e LPs
          </Link>
        </div>
      </header>

      <form className="surface-panel ga4-filters" action="/analytics/origins">
        <label className="filter-field">
          <span>Início</span>
          <input type="date" name="since" defaultValue={report?.since ?? since} />
        </label>
        <label className="filter-field">
          <span>Fim</span>
          <input type="date" name="until" defaultValue={report?.until ?? until} />
        </label>
        <button className="button primary" type="submit">
          Aplicar
        </button>
      </form>

      {error ? (
        <section className="surface-panel ga4-section-state" role="status">
          <strong>Não foi possível carregar a origem dos leads</strong>
          <span>{error}</span>
        </section>
      ) : report ? (
        <>
          <article className="ga4-kpi-card tracking-kpis">
            <header>
              <strong>
                Leads de {report.since} a {report.until}
              </strong>
            </header>
            <dl>
              <div>
                <dt>Total</dt>
                <dd>{report.total.toLocaleString("pt-BR")}</dd>
              </div>
              <div>
                <dt>
                  <Link href={filterHref(period, { group: "paid" })}>Tráfego pago</Link>
                </dt>
                <dd>{report.paid.toLocaleString("pt-BR")}</dd>
                <small>{share(report.paid, report.total)}</small>
              </div>
              <div>
                <dt>
                  <Link href={filterHref(period, { group: "organic" })}>Tráfego orgânico</Link>
                </dt>
                <dd>{report.organic.toLocaleString("pt-BR")}</dd>
                <small>{share(report.organic, report.total)}</small>
              </div>
            </dl>
          </article>

          <section className="surface-panel ga4-panel">
            <header className="ga4-panel-header">
              <span className="eyebrow">Canais</span>
              <h2>Pago e orgânico por canal</h2>
            </header>
            <div className="table-wrap ga4-table-wrap">
              <table className="ga4-table compact">
                <thead>
                  <tr>
                    <th scope="col">Grupo</th>
                    <th scope="col">Canal</th>
                    <th scope="col">Leads</th>
                    <th scope="col">Participação</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...channelCounts(report, paidChannels).map((row) => ({ ...row, label: "Pago" })),
                    ...channelCounts(report, organicChannels).map((row) => ({ ...row, label: "Orgânico" })),
                  ].map((row) => (
                    <tr key={row.channel}>
                      <td>{row.label}</td>
                      <th scope="row">
                        <Link href={filterHref(period, { channel: row.channel })}>{channelLabel(row.channel)}</Link>
                      </th>
                      <td>
                        {row.count.toLocaleString("pt-BR")}
                        {row.probable ? ` (${row.probable} provável${row.probable > 1 ? "is" : ""})` : ""}
                      </td>
                      <td>{share(row.count, report.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="surface-panel ga4-panel">
            <header className="ga4-panel-header">
              <span className="eyebrow">Leads</span>
              <h2>
                {group ? (group === "paid" ? "Tráfego pago" : "Tráfego orgânico") : channel ? channelLabel(channel) : "Todos"}
              </h2>
              {group || channel ? (
                <p>
                  <Link href={filterHref(period, {})}>Mostrar todos</Link>
                </p>
              ) : null}
            </header>
            {rows.length ? (
              <div className="table-wrap ga4-table-wrap">
                <table className="ga4-table compact">
                  <thead>
                    <tr>
                      <th scope="col">Contato</th>
                      <th scope="col">Nome</th>
                      <th scope="col">Entrada</th>
                      <th scope="col">Origem (primeiro contato)</th>
                      <th scope="col">Campanha</th>
                      <th scope="col">Último clique não direto</th>
                      <th scope="col">Visitas</th>
                      <th scope="col">Código</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={`${row.at}-${index}`}>
                        <td>{dateTime(row.at)}</td>
                        <td>{row.name ?? "—"}</td>
                        <td>{entryLabels[row.entry] ?? row.entry}</td>
                        <th scope="row">
                          {channelLabel(row.channel)}
                          {row.confidence === "probable" ? " (provável)" : ""}
                        </th>
                        <td>{row.campaign ?? "—"}</td>
                        <td>{row.firstTouch ? touchText(row.lastNonDirect) : "—"}</td>
                        <td>{row.visits ? row.visits.toLocaleString("pt-BR") : "—"}</td>
                        <td>{row.refToken ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ga4-note">Nenhum lead neste filtro.</p>
            )}
            {report.truncated ? <p className="ga4-note warn">Mostrando os 200 leads mais recentes.</p> : null}
          </section>

          <section className="surface-panel ga4-panel">
            <header className="ga4-panel-header">
              <span className="eyebrow">Método</span>
              <h2>Como a origem é definida</h2>
            </header>
            <ul className="ga4-plain-list">
              <li>
                Contatos do site e das LPs (código Atendimento): a origem é a do primeiro contato do mesmo navegador nos{" "}
                {report.lookbackDays} dias anteriores à mensagem. Cada visita (sessão) é classificada pela URL de entrada
                (gclid, fbclid, UTMs) e pelo site de origem.
              </li>
              <li>
                Google Ads: gclid, gbraid ou wbraid, ou UTM paga do Google. Meta Ads: UTM paga do Facebook/Instagram;
                com fbclid sem UTM paga, a Meta é marcada como provável.
              </li>
              <li>
                Anúncios Click-to-WhatsApp: pagos (Meta) pelo ctwa_clid. WhatsApp direto (sem código e sem anúncio): orgânico,
                contado na primeira mensagem do número registrada no RastrackDash.
              </li>
              <li>
                A origem vale por navegador: outro aparelho, outro navegador ou cookies apagados perdem o histórico. Visitas
                anteriores a 26/11/2026 não foram coletadas. Sessões do Tag Assistant e do Gerenciador de Eventos são
                ignoradas.
              </li>
            </ul>
          </section>
        </>
      ) : null}
    </section>
  );
}
