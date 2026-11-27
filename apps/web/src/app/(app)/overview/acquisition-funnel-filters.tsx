"use client";

import { useRef } from "react";

/** Funnel filters apply on change, like the overview filters (no submit button). */
export function AcquisitionFunnelFilters({
  hiddenParams,
  selects,
}: {
  hiddenParams: Record<string, string>;
  selects: { name: string; label: string; value: string; options: { value: string; label: string }[] }[];
}) {
  const form = useRef<HTMLFormElement>(null);
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
    </form>
  );
}
