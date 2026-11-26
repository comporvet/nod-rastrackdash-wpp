import Link from "next/link";
import { SubmitButton } from "../../../../components/submit-button";
import { getCurrentWorkspace } from "../../../../lib/current-workspace";
import { isApiRequestError, serverApiFetch } from "../../../../lib/server-api";
import { updateTrackingConnection } from "./actions";
import { TrackingTokenForm } from "./token-form";
import {
  contactStatusLabels,
  coverage,
  dateTime,
  environmentLabel,
  environmentMatrix,
  latency,
  rejectionLabels,
  type TrackingConnectionState,
  type TrackingMonitor,
} from "./tracking-types";

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function integer(value: number): string {
  return value.toLocaleString("pt-BR");
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

export default async function TrackingMonitorPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = searchParams ? await searchParams : {};
  const workspace = await getCurrentWorkspace();
  if (!workspace.permissions.canViewReports) {
    return (
      <section className="page-stack page-standard">
        <p className="ga4-section-state">Sem permissão para ver relatórios.</p>
      </section>
    );
  }
  const canConfigure = workspace.permissions.canManageIntegrations;
  const query = new URLSearchParams();
  const since = single(params.since);
  const until = single(params.until);
  if (since) query.set("since", since);
  if (until) query.set("until", until);

  let monitor: TrackingMonitor | null = null;
  let monitorError: string | null = null;
  try {
    monitor = await serverApiFetch<TrackingMonitor>(`/tracking/monitor?${query.toString()}`);
  } catch (error) {
    monitorError = isApiRequestError(error) ? error.message : "API indisponível";
  }
  const connection = canConfigure
    ? await serverApiFetch<TrackingConnectionState>("/tracking/connection").catch(() => null)
    : null;
  const matrix = monitor ? environmentMatrix(monitor.byEnvironmentAndEvent) : null;
  const error = single(params.error);

  return (
    <section className="page-stack page-wide ga4-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">GTM Server-Side</span>
          <h1>Tracking Monitor</h1>
          <p>
            Eventos que o contêiner de servidor envia ao RastrackDash, já deduplicados. Não substitui os relatórios do
            GA4: mostra o que chegou aqui e a qualidade dos identificadores.
          </p>
        </div>
        <div className="header-actions">
          <Link className="button ghost" href="/analytics">
            Voltar para Site e LPs
          </Link>
        </div>
      </header>

      {error ? <p className="ga4-note bad" role="alert">{error}</p> : null}
      {single(params.saved) === "1" ? <p className="ga4-note">Configuração salva.</p> : null}
      {monitor && !monitor.enabled ? (
        <p className="ga4-note warn">
          A recepção está desligada nesta instalação (TRACKING_INGEST_ENABLED). Os eventos enviados recebem 404.
        </p>
      ) : null}

      <form className="surface-panel ga4-filters" action="/analytics/tracking">
        <label className="filter-field">
          <span>Início</span>
          <input type="date" name="since" defaultValue={monitor?.since ?? since} />
        </label>
        <label className="filter-field">
          <span>Fim</span>
          <input type="date" name="until" defaultValue={monitor?.until ?? until} />
        </label>
        <button className="button primary" type="submit">
          Aplicar
        </button>
      </form>

      {monitorError ? (
        <section className="surface-panel ga4-section-state" role="status">
          <strong>Não foi possível carregar o monitor</strong>
          <span>{monitorError}</span>
        </section>
      ) : monitor ? (
        <>
          <article className="ga4-kpi-card tracking-kpis">
            <header>
              <strong>Recebimento ({monitor.since} a {monitor.until})</strong>
              <span className={`status-chip ${monitor.status === "active" ? "" : "warn"}`.trim()}>
                {monitor.configured ? (monitor.status === "active" ? "Ativa" : "Pausada") : "Não configurada"}
              </span>
            </header>
            <dl>
              <Kpi label="Eventos únicos" value={integer(monitor.uniqueEvents)} />
              <Kpi label="Recebimentos" value={integer(monitor.receipts)} />
              <Kpi label="Recebimentos duplicados" value={integer(monitor.duplicateReceipts)} />
              <Kpi
                label="Recusas registradas"
                value={integer(monitor.rejections.reduce((sum, row) => sum + row.count, 0))}
                hint="No máximo 1 registro por minuto por motivo"
              />
              <Kpi label="Último recebimento" value={dateTime(monitor.lastReceivedAt)} />
              <Kpi
                label="Latência p50 / p95"
                value={`${latency(monitor.latencyMs.p50)} / ${latency(monitor.latencyMs.p95)}`}
                hint="Do horário do evento até a chegada aqui"
              />
            </dl>
          </article>
          {monitor.truncated ? (
            <p className="ga4-note warn">Período com mais de 50.000 eventos: reduza o intervalo para números completos.</p>
          ) : null}

          <section className="surface-panel ga4-panel">
            <header className="ga4-panel-header">
              <span className="eyebrow">Ambientes</span>
              <h2>Eventos únicos por ambiente</h2>
            </header>
            {matrix && matrix.rows.length ? (
              <div className="table-wrap ga4-table-wrap">
                <table className="ga4-table compact">
                  <thead>
                    <tr>
                      <th scope="col">Ambiente</th>
                      {matrix.eventNames.map((name) => (
                        <th key={name} scope="col">
                          {name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.rows.map((row) => (
                      <tr key={row.environment}>
                        <th scope="row">{environmentLabel(row.environment)}</th>
                        {row.counts.map((count, index) => (
                          <td key={matrix.eventNames[index]}>{integer(count)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ga4-note">Nenhum evento no período.</p>
            )}
            <p className="ga4-note">
              Cada clique genérico (click) é contado à parte e nunca somado aos cliques no WhatsApp.
            </p>
          </section>

          <section className="surface-panel ga4-panel">
            <header className="ga4-panel-header">
              <span className="eyebrow">Qualidade</span>
              <h2>Cobertura dos identificadores</h2>
            </header>
            <dl className="tracking-quality">
              <Kpi
                label="Com event_id"
                value={coverage(monitor.quality.eventIdCoverage)}
                hint={`${integer(monitor.derivedKeys)} com chave derivada (deduplicação menos confiável)`}
              />
              <Kpi label="Com sessão" value={coverage(monitor.quality.sessionCoverage)} />
              <Kpi label="Com UTM" value={coverage(monitor.quality.utmCoverage)} />
              <Kpi label="Com identificador Google" value={coverage(monitor.quality.googleIdCoverage)} hint="gclid, gbraid, wbraid ou dclid" />
              <Kpi label="Com identificador Meta" value={coverage(monitor.quality.metaIdCoverage)} hint="fbclid, fbp, fbc ou ctwa_clid" />
            </dl>
            {monitor.rejections.length ? (
              <ul className="ga4-plain-list">
                {monitor.rejections.map((row) => (
                  <li key={row.reason}>
                    {rejectionLabels[row.reason] ?? row.reason}: <strong>{integer(row.count)}</strong>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="surface-panel ga4-panel">
            <header className="ga4-panel-header">
              <span className="eyebrow">WhatsApp oficial</span>
              <h2>Contatos ligados a um clique</h2>
              <p>
                Mensagens recebidas pela API oficial com o token Ref.: CV-XXXXXX do clique no site ou na LP. Cada token gera
                no máximo um Lead de site na Meta.
              </p>
            </header>
            {monitor.contacts.length ? (
              <ul className="ga4-plain-list">
                {monitor.contacts.map((row) => (
                  <li key={row.status}>
                    {contactStatusLabels[row.status] ?? row.status}: <strong>{integer(row.count)}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ga4-note">Nenhum contato com token no período.</p>
            )}
            {monitor.recentContacts.length ? (
              <div className="table-wrap ga4-table-wrap">
                <table className="ga4-table compact">
                  <thead>
                    <tr>
                      <th scope="col">Mensagem</th>
                      <th scope="col">Token</th>
                      <th scope="col">Ambiente do clique</th>
                      <th scope="col">Situação</th>
                      <th scope="col">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monitor.recentContacts.map((row) => (
                      <tr key={row.refToken}>
                        <td>{dateTime(row.messageAt)}</td>
                        <th scope="row">{row.refToken}</th>
                        <td>{row.environment ? `${environmentLabel(row.environment)} ${row.pagePath ?? ""}` : "—"}</td>
                        <td>{contactStatusLabels[row.status] ?? row.status}</td>
                        <td>{row.status === "sent" ? dateTime(row.sentAt) : row.lastError ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="surface-panel ga4-panel">
            <header className="ga4-panel-header">
              <span className="eyebrow">Últimos eventos</span>
              <h2>Chegadas mais recentes</h2>
            </header>
            {monitor.recent.length ? (
              <div className="table-wrap ga4-table-wrap">
                <table className="ga4-table compact">
                  <thead>
                    <tr>
                      <th scope="col">Recebido</th>
                      <th scope="col">Evento</th>
                      <th scope="col">Ambiente</th>
                      <th scope="col">Página</th>
                      <th scope="col">Chave</th>
                      <th scope="col">Recebimentos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monitor.recent.map((event, index) => (
                      <tr key={`${event.receivedAt}-${index}`}>
                        <td>{dateTime(event.receivedAt)}</td>
                        <th scope="row">{event.eventName}</th>
                        <td>{environmentLabel(event.environment)}</td>
                        <td>{event.pagePath ?? "—"}</td>
                        <td>{event.dedupeConfidence === "event_id" ? "event_id" : "derivada"}</td>
                        <td>{integer(event.receipts)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ga4-note">Nada recebido ainda.</p>
            )}
          </section>
        </>
      ) : null}

      {canConfigure && connection ? (
        <section className="surface-panel ga4-panel">
          <header className="ga4-panel-header">
            <span className="eyebrow">Configuração</span>
            <h2>Recepção do GTM Server-Side</h2>
            <p>
              A tag 04 - [RASTRACKDASH] Enviar Eventos do contêiner de servidor envia cada evento para o endereço abaixo,
              com o ID da conexão e o token. Guia: docs/setup/gtm-server-side.md.
            </p>
          </header>
          <p>
            Endereço: <code>{connection.endpointUrl ?? "defina API_PUBLIC_URL na API"}</code>
          </p>
          {connection.connection ? (
            <p>
              ID da conexão: <code>{connection.connection.id}</code>. Criada em {dateTime(connection.connection.createdAt)}.
            </p>
          ) : null}
          <TrackingTokenForm configured={connection.connection !== null} />
          {connection.connection ? (
            <form action={updateTrackingConnection} className="ga4-settings-form">
              <label className="filter-field">
                <span>Eventos permitidos (os demais são ignorados)</span>
                <input name="allowedEvents" defaultValue={connection.connection.allowedEvents.join(", ")} />
              </label>
              <label className="filter-field">
                <span>
                  <input type="checkbox" name="metaLeadEnabled" defaultChecked={connection.connection.metaLeadEnabled} />{" "}
                  Enviar Lead de site à Meta quando o WhatsApp oficial receber o token do clique
                </span>
              </label>
              <label className="filter-field">
                <span>Pixel / conjunto de dados da Meta (vazio = o da conexão Meta)</span>
                <input
                  name="metaPixelId"
                  inputMode="numeric"
                  placeholder="1075406568726436"
                  defaultValue={connection.connection.metaPixelId ?? ""}
                />
              </label>
              <label className="filter-field">
                <span>Código de teste da Meta (só para teste controlado; deixe vazio em produção)</span>
                <input name="metaTestEventCode" defaultValue={connection.connection.metaTestEventCode ?? ""} />
              </label>
              <label className="filter-field">
                <span>Situação</span>
                <select name="status" defaultValue={connection.connection.status}>
                  <option value="active">Ativa</option>
                  <option value="paused">Pausada (recusa tudo com 404)</option>
                </select>
              </label>
              <div className="header-actions">
                <SubmitButton className="button primary" pendingLabel="Salvando...">
                  Salvar
                </SubmitButton>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
