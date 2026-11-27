import {
  FUNNEL_PARAM,
  brl,
  channelOptions,
  entryOptions,
  funnelRows,
  groupOptions,
  integer,
  percent,
  trapezoid,
  type AcquisitionFunnelData,
} from "./acquisition-funnel-model";
import { AcquisitionFunnelFilters } from "./acquisition-funnel-filters";

const STAGE_HEIGHT = 14;

export function AcquisitionFunnel({
  data,
  error,
  hiddenParams,
}: {
  data: AcquisitionFunnelData | null;
  error: string | null;
  hiddenParams: Record<string, string>;
}) {
  const rows = data ? funnelRows(data) : [];
  const filters = data?.filters ?? { group: "all", channels: [], entry: "all", campaignIds: [] };
  const height = Math.max(1, rows.length) * STAGE_HEIGHT;

  return (
    <section className="surface-panel acquisition-funnel" aria-label="Funil de aquisição">
      <div className="overview-section-heading">
        <div>
          <span className="eyebrow">Funil de aquisição</span>
          <h2>Do anúncio ao cliente</h2>
          <p>
            Impressões e cliques vêm dos anúncios; visitas e cliques no WhatsApp, do rastreamento do site e das LPs;
            mensagens, agendamentos e clientes, do WhatsApp oficial e do banco da Comporvet.
          </p>
        </div>
      </div>

      <AcquisitionFunnelFilters
        hiddenParams={hiddenParams}
        selects={[
          { name: FUNNEL_PARAM.group, label: "Tráfego", value: filters.group, options: groupOptions },
          { name: FUNNEL_PARAM.entry, label: "Entrada", value: filters.entry, options: entryOptions },
        ]}
        multi={{ name: FUNNEL_PARAM.channel, label: "Canais", values: filters.channels ?? [], options: channelOptions }}
      />

      {error || !data ? (
        <div className="overview-unavailable" role="status">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>Funil indisponível</strong>
            <span>{error ?? "Tente novamente em instantes."}</span>
          </div>
        </div>
      ) : (
        <div className="acquisition-funnel-body">
          <svg
            className="acquisition-funnel-chart"
            viewBox={`0 0 100 ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Representação do funil de aquisição"
          >
            {rows.map((row, index) => (
              <polygon
                key={row.key}
                className={`acquisition-funnel-shape stage-${index + 1}${row.value === null ? " is-empty" : ""}`}
                points={trapezoid(rows, index, STAGE_HEIGHT)}
              />
            ))}
          </svg>

          <ol className="acquisition-funnel-list">
            {rows.map((row, index) => (
              <li key={row.key} className={row.value === null ? "is-empty" : undefined}>
                <span className={`acquisition-funnel-dot stage-${index + 1}`} aria-hidden="true" />
                <div className="acquisition-funnel-label">
                  <strong>{row.label}</strong>
                  {row.breakdown.length > 1 ? (
                    <small>{row.breakdown.map((item) => `${item.label}: ${integer(item.value)}`).join(" · ")}</small>
                  ) : null}
                  {row.enteredTotal > 0 ? (
                    <small className="acquisition-funnel-entered">
                      + {integer(row.enteredTotal)} entraram aqui por outro caminho:{" "}
                      {(row.entered ?? []).map((item) => `${item.label} ${integer(item.value)}`).join(" · ")}
                    </small>
                  ) : null}
                  {row.note ? <small>{row.note}</small> : null}
                </div>
                <div className="acquisition-funnel-value">
                  <strong>{integer(row.value)}</strong>
                  <span className="acquisition-funnel-share">
                    {row.fromTop === null ? "—" : percent(row.fromTop)}
                  </span>
                  <small>
                    {row.value === null
                      ? "Não se aplica"
                      : row.previousTotal === null
                        ? "Topo do funil"
                        : row.fromPrevious === null
                          ? "—"
                          : `${percent(row.fromPrevious)} dos ${integer(row.previousTotal)} da etapa anterior`}
                  </small>
                  {row.enteredTotal > 0 ? <small>{integer(row.total)} no total da etapa</small> : null}
                  {row.costCents !== null ? <small>{brl(row.costCents)} por pessoa nesta etapa</small> : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {data ? (
        <p className="acquisition-funnel-footnote">
          Período {data.since} a {data.until}.
          {data.spendCents !== null ? ` Investimento Meta: ${brl(data.spendCents)}.` : ""} Origem pelo primeiro contato do
          navegador nos {data.lookbackDays} dias anteriores. Pagos: Google Ads e Meta Ads; orgânicos: busca, redes sociais,
          outros sites, acesso direto e WhatsApp direto.
          {data.filters.campaignIds.length
            ? " O filtro de campanhas da página vale para as métricas e leads da Meta."
            : ""}
        </p>
      ) : null}
    </section>
  );
}
