"use client";

import { useState, type PointerEvent } from "react";

export type LineSeries = { key: string; label: string; color: string; values: number[] };

const width = 720;
const height = 240;
const left = 44;
const right = 16;
const top = 16;
const bottom = 32;

function formatDay(date: string) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

export function Ga4LineChart({ title, dates, series }: { title: string; dates: string[]; series: LineSeries[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const maximum = Math.max(1, ...series.flatMap((item) => item.values));
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index: number) => left + (dates.length <= 1 ? plotWidth / 2 : (index / (dates.length - 1)) * plotWidth);
  const y = (value: number) => top + plotHeight - (value / maximum) * plotHeight;
  const labelEvery = Math.max(1, Math.ceil(dates.length / 8));

  function onMove(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    setHover(Math.min(dates.length - 1, Math.max(0, Math.round(ratio * (dates.length - 1)))));
  }

  return (
    <figure className="ga4-chart">
      <figcaption>{title}</figcaption>
      <div className="ga4-chart-legend" aria-label="Legenda">
        {series.map((item) => (
          <span key={item.key}>
            <i style={{ background: item.color }} aria-hidden="true" />
            {item.label} <strong>{item.values.reduce((sum, value) => sum + value, 0).toLocaleString("pt-BR")}</strong>
          </span>
        ))}
      </div>
      <div className="ga4-chart-frame">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          {[0, 0.5, 1].map((ratio) => (
            <g key={ratio} className="ga4-grid">
              <line x1={left} x2={width - right} y1={y(maximum * ratio)} y2={y(maximum * ratio)} />
              <text x={left - 8} y={y(maximum * ratio) + 4} textAnchor="end">
                {Math.round(maximum * ratio).toLocaleString("pt-BR")}
              </text>
            </g>
          ))}
          {dates.map((date, index) =>
            index % labelEvery === 0 || index === dates.length - 1 ? (
              <text key={date} className="ga4-axis" x={x(index)} y={height - 10} textAnchor="middle">
                {formatDay(date)}
              </text>
            ) : null,
          )}
          {series.map((item) => (
            <polyline
              key={item.key}
              fill="none"
              stroke={item.color}
              strokeWidth={2}
              strokeLinejoin="round"
              points={item.values.map((value, index) => `${x(index)},${y(value)}`).join(" ")}
            />
          ))}
          {hover !== null ? (
            <g>
              <line className="ga4-crosshair" x1={x(hover)} x2={x(hover)} y1={top} y2={top + plotHeight} />
              {series.map((item) => (
                <circle
                  key={item.key}
                  cx={x(hover)}
                  cy={y(item.values[hover] ?? 0)}
                  r={4}
                  fill={item.color}
                  className="ga4-point"
                />
              ))}
            </g>
          ) : null}
          <rect
            x={left}
            y={top}
            width={plotWidth}
            height={plotHeight}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover !== null ? (
          <div
            className="ga4-tooltip"
            style={{ left: `${(x(hover) / width) * 100}%` }}
            role="status"
          >
            <strong>{formatDay(dates[hover] ?? "")}</strong>
            {series.map((item) => (
              <span key={item.key}>
                <i style={{ background: item.color }} aria-hidden="true" />
                {item.label}: {(item.values[hover] ?? 0).toLocaleString("pt-BR")}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </figure>
  );
}
