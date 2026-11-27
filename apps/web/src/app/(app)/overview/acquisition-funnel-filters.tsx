"use client";

import { useEffect, useRef, useState } from "react";

type Option = { value: string; label: string };

/** Funnel filters apply on change, like the overview filters (no submit button). */
export function AcquisitionFunnelFilters({
  hiddenParams,
  selects,
  multi,
}: {
  hiddenParams: Record<string, string>;
  selects: { name: string; label: string; value: string; options: Option[] }[];
  multi: { name: string; label: string; values: string[]; options: Option[] };
}) {
  const form = useRef<HTMLFormElement>(null);
  const dropdown = useRef<HTMLDetailsElement>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(multi.values));
  const initial = useRef(new Set(multi.values));

  const changed = () =>
    checked.size !== initial.current.size || [...checked].some((value) => !initial.current.has(value));

  // The choice applies when the list closes, so several channels can be ticked in one go.
  const onToggle = () => {
    if (!dropdown.current?.open && changed()) form.current?.requestSubmit();
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
        ? (multi.options.find((option) => checked.has(option.value))?.label ?? "1 canal")
        : `${checked.size} canais`;

  return (
    <form ref={form} className="acquisition-funnel-filters" action="/overview">
      {Object.entries(hiddenParams).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {selects.map((select) => (
        <label key={select.name} className="filter-field">
          <span>{select.label}</span>
          <select name={select.name} defaultValue={select.value} onChange={() => form.current?.requestSubmit()}>
            {select.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div className="filter-field">
        <span>{multi.label}</span>
        <details ref={dropdown} className="funnel-multi" onToggle={onToggle}>
          <summary>{summary}</summary>
          <div className="funnel-multi-list" role="group" aria-label={multi.label}>
            <label>
              <input type="checkbox" checked={checked.size === 0} onChange={() => setChecked(new Set())} />
              Todos os canais
            </label>
            {multi.options.map((option) => (
              <label key={option.value}>
                <input
                  type="checkbox"
                  name={multi.name}
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
    </form>
  );
}
