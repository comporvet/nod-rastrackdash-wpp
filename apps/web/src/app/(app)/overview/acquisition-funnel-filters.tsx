"use client";

import { useEffect, useRef, useState } from "react";

type Option = { value: string; label: string };

export type FunnelFilterValues = { group: string; channels: string[]; entry: string };

/** Funnel filters apply on change (no submit button); only the funnel reloads. */
export function AcquisitionFunnelFilters({
  values,
  groupOptions,
  entryOptions,
  channelOptions,
  disabled,
  onChange,
}: {
  values: FunnelFilterValues;
  groupOptions: Option[];
  entryOptions: Option[];
  channelOptions: Option[];
  disabled?: boolean;
  onChange: (next: FunnelFilterValues) => void;
}) {
  const dropdown = useRef<HTMLDetailsElement>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(values.channels));
  const checkedRef = useRef(checked);
  checkedRef.current = checked;
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const changed = () => {
    const current = new Set(valuesRef.current.channels);
    return (
      checkedRef.current.size !== current.size || [...checkedRef.current].some((value) => !current.has(value))
    );
  };

  // The channel choice applies when the list closes, so several channels can be ticked in one go.
  const onToggle = () => {
    if (!dropdown.current?.open && changed()) {
      onChange({ ...valuesRef.current, channels: [...checkedRef.current] });
    }
  };

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (dropdown.current?.open && !dropdown.current.contains(event.target as Node)) dropdown.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const toggle = (value: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  const summary =
    checked.size === 0
      ? "Todos os canais"
      : checked.size === 1
        ? (channelOptions.find((option) => checked.has(option.value))?.label ?? "1 canal")
        : `${checked.size} canais`;

  return (
    <div className="acquisition-funnel-filters" role="group" aria-label="Filtros do funil">
      <label className="filter-field">
        <span>Tráfego</span>
        <select
          value={values.group}
          disabled={disabled}
          onChange={(event) => onChange({ ...values, group: event.target.value })}
        >
          {groupOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="filter-field">
        <span>Canais</span>
        <details ref={dropdown} className="funnel-multi" onToggle={onToggle}>
          <summary aria-disabled={disabled}>{summary}</summary>
          <div className="funnel-multi-list" role="group" aria-label="Canais">
            <label>
              <input type="checkbox" checked={checked.size === 0} onChange={() => setChecked(new Set())} />
              Todos os canais
            </label>
            {channelOptions.map((option) => (
              <label key={option.value}>
                <input
                  type="checkbox"
                  value={option.value}
                  checked={checked.has(option.value)}
                  onChange={() => toggle(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </details>
      </div>
      <label className="filter-field">
        <span>Entrada</span>
        <select
          value={values.entry}
          disabled={disabled}
          onChange={(event) => onChange({ ...values, entry: event.target.value })}
        >
          {entryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
