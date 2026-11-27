"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  LEVEL_LABEL,
  METRIC_GROUPS,
  expandedToLevel,
  formatMetric,
  sumMetrics,
  visibleMetrics,
  type MetricDefinition,
  type MetricGroupKey,
  type OptimizationNode,
  type OptimizationReport,
} from "./optimization-model";

function Help({ label, text }: { label: string; text: string }) {
  return (
    <span className="metric-help" tabIndex={0} aria-label={`${label}: ${text}`}>
      {label}
      <span className="metric-help-tip" role="tooltip">
        <strong>{label}</strong>
        {text}
      </span>
    </span>
  );
}

export function OptimizationTable({
  report,
  initialLevel,
}: {
  report: OptimizationReport;
  initialLevel: OptimizationNode["level"];
}) {
  const [expanded, setExpanded] = useState(() => new Set(expandedToLevel(report.campaigns, initialLevel)));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<MetricGroupKey>>(() => new Set());
  const metrics = visibleMetrics(collapsedGroups);
  const total = useMemo(() => sumMetrics(report.campaigns), [report.campaigns]);

  const toggleRow = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleGroup = (key: MetricGroupKey) =>
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const openTo = (level: OptimizationNode["level"]) => setExpanded(new Set(expandedToLevel(report.campaigns, level)));

  const groupSpans = METRIC_GROUPS.map((group) => ({
    ...group,
    span: metrics.filter((metric) => metric.group === group.key).length,
    collapsed: collapsedGroups.has(group.key),
  }));

  const renderRow = (node: OptimizationNode, depth: number): ReactNode => {
    const open = expanded.has(node.id);
    const childLabel = node.level === "campaign" ? "conjuntos" : "anúncios";
    return (
      <Fragment key={`${node.level}:${node.id}`}>
        <tr className={`optimization-row level-${node.level}`}>
          <th scope="row" className="optimization-name">
            <div className="optimization-name-cell" style={{ paddingLeft: `${depth * 1.25}rem` }}>
            {node.children.length ? (
              <button
                type="button"
                className="optimization-toggle"
                aria-expanded={open}
                aria-label={`${open ? "Recolher" : "Expandir"} ${childLabel} de ${node.name}`}
                onClick={() => toggleRow(node.id)}
              >
                {open ? "−" : "+"}
              </button>
            ) : (
              <span className="optimization-toggle-spacer" aria-hidden="true" />
            )}
            <span className="optimization-name-text">
              <small>{LEVEL_LABEL[node.level]}</small>
              <span title={node.name}>{node.name}</span>
            </span>
            </div>
          </th>
          {metrics.map((metric) => (
            <MetricCell key={metric.key} metric={metric} node={node} />
          ))}
        </tr>
        {open ? node.children.map((child) => renderRow(child, depth + 1)) : null}
      </Fragment>
    );
  };

  return (
    <section className="surface-panel optimization-panel" aria-label="Métricas de otimização">
      <div className="optimization-toolbar">
        <div>
          <span className="eyebrow">Guia de otimização de métricas</span>
          <h2>
            Período {report.since} a {report.until}
          </h2>
          <p>Passe o mouse sobre o nome de uma métrica para ver o que ela significa e como melhorá-la.</p>
        </div>
        <div className="optimization-actions" role="group" aria-label="Expandir linhas">
          <button type="button" className="button ghost" onClick={() => openTo("campaign")}>
            Só campanhas
          </button>
          <button type="button" className="button ghost" onClick={() => openTo("adset")}>
            Abrir conjuntos
          </button>
          <button type="button" className="button ghost" onClick={() => openTo("ad")}>
            Abrir anúncios
          </button>
        </div>
      </div>

      {report.campaigns.length === 0 ? (
        <p className="optimization-empty">Nenhuma campanha com os filtros e o período escolhidos.</p>
      ) : (
        <div className="table-scroll optimization-scroll">
          <table className="optimization-table">
            <thead>
              <tr className="optimization-group-row">
                <th scope="col" rowSpan={2} className="optimization-name">
                  Campanha / conjunto / anúncio
                </th>
                {groupSpans.map((group) => (
                  <th
                    key={group.key}
                    scope="colgroup"
                    colSpan={group.span}
                    className={`optimization-group group-${group.key}${group.collapsed ? " is-collapsed" : ""}`}
                  >
                    <button
                      type="button"
                      aria-expanded={!group.collapsed}
                      aria-label={`${group.collapsed ? "Expandir" : "Recolher"} a categoria ${group.label}`}
                      onClick={() => toggleGroup(group.key)}
                    >
                      {group.collapsed ? "+" : "−"}
                    </button>
                    <Help label={group.label} text={group.help} />
                  </th>
                ))}
              </tr>
              <tr>
                {metrics.map((metric) => (
                  <th key={metric.key} scope="col" className={`optimization-metric group-${metric.group}`}>
                    <Help label={metric.label} text={metric.help} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{report.campaigns.map((campaign) => renderRow(campaign, 0))}</tbody>
            <tfoot>
              <tr className="optimization-total">
                <th scope="row" className="optimization-name">
                  Total ({report.campaigns.length} campanhas)
                </th>
                {metrics.map((metric) => (
                  <td key={metric.key}>{formatMetric(metric.value(total), metric.format, total.currency)}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="optimization-footnote">
        Entrega, cliques e visualizações vêm da Meta (sincronização diária). Conversas, qualificados, vendas e receita
        vêm do RastrackDash, com a mesma atribuição das outras telas. Ficaram de fora as métricas do guia que não
        existem na operação: custo por seguidor, visualização de produto, carrinho, abandono de carrinho, checkout e
        webinar. A conversão da LP por campanha depende de UTMs nos anúncios do site: veja Site e LPs, Origem dos leads.
      </p>
    </section>
  );
}

function MetricCell({ metric, node }: { metric: MetricDefinition; node: OptimizationNode }) {
  const value = metric.value(node.metrics);
  return <td className={`group-${metric.group}`}>{formatMetric(value, metric.format, node.metrics.currency)}</td>;
}
