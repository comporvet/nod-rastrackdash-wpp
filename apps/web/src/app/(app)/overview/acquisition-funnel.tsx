"use client";

import { useRef, useState } from "react";
import { apiFetch } from "../../../lib/api";
import {
  FUNNEL_PARAM,
  brl,
  channelOptions,
  entryOptions,
  funnelRows,
  groupOptions,
  integer,
  isFunnelData,
  percent,
  trapezoid,
  type AcquisitionFunnelData,
} from "./acquisition-funnel-model";
import { AcquisitionFunnelFilters, type FunnelFilterValues } from "./acquisition-funnel-filters";

const STAGE_HEIGHT = 14;

export function AcquisitionFunnel({
  data: initialData,
  error: initialError,
}: {
  data: AcquisitionFunnelData | null;
  error: string | null;
}) {
  const [data, setData] = useState(initialData);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const filters = data?.filters ?? { group: "all", channels: [], entry: "all", campaignIds: [] };
  const rows = data ? funnelRows(data) : [];
  const height = Math.max(1, rows.length) * STAGE_HEIGHT;

  // Only the funnel reloads: the rest of the overview keeps its data.
  const apply = async (next: FunnelFilterValues) => {
    const id = ++request.current;
    const params = new URLSearchParams();
    if (data?.since && data?.until) {
      params.set("since", data.since);
      params.set("until", data.until);
    }
    if (next.group !== "all") params.set("group", next.group);
    if (next.channels.length) params.set("channel", next.channels.join(","));
    if (next.entry !== "all") params.set("entry", next.entry);
    if (filters.campaignIds.length) params.set("campaignIds", filters.campaignIds.join(","));
    setLoading(true);
    try {
      const result = await apiFetch<unknown>(`/tracking/acquisition-funnel?${params.toString()}`);
      if (id !== request.current) return;
      if (isFunnelData(result)) {
        setData(result);
        setError(null);
      } else {
        setError("Resposta inesperada da API.");
      }
      const url = new URL(window.location.href);
      url.searchParams.delete(FUNNEL_PARAM.group);
      url.searchParams.delete(FUNNEL_PARAM.entry);
      url.searchParams.delete(FUNNEL_PARAM.channel);
      if (next.group !== "all") url.searchParams.set(FUNNEL_PARAM.group, next.group);
      if (next.entry !== "all") url.searchParams.set(FUNNEL_PARAM.entry, next.entry);
      for (const channel of next.channels) url.searchParams.append(FUNNEL_PARAM.channel, channel);
      window.history.replaceState(window.history.state, "", url);
    } catch (cause) {
      if (id === request.current) setError(cause instanceof Error ? cause.message : "API indisponível.");
    } finally {
      if (id === request.current) setLoading(false);
    }
  };

  return (
    <section
      className={`surface-panel acquisition-funnel${loading ? " is-loading" : ""}`}
      aria-label="Funil de aquisição"
      aria-busy={loading || undefined}
    >
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
        values={{ group: filters.group, channels: filters.channels ?? [], entry: filters.entry }}
        groupOptions={groupOptions}
        entryOptions={entryOptions}
        channelOptions={channelOptions}
        disabled={!data}
        onChange={apply}
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
                  <span className="acquisition-funnel-share">{row.fromTop === null ? "—" : percent(row.fromTop)}</span>
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
          outros sites, acesso direto e WhatsApp direto. O percentual abaixo de cada número é sobre a primeira etapa do
          funil.
          {data.filters.campaignIds.length
            ? " O filtro de campanhas da página vale para as métricas e leads da Meta."
            : ""}
        </p>
      ) : null}
    </section>
  );
}
