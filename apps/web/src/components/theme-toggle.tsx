"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export const themeStorageKey = "rastrackdash-theme";
export const themeEvent = "rastrackdash:theme";
export type Theme = "dark" | "light";

function themeFromDocument(): Theme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // The theme still switches when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(themeEvent));
}

export function useTheme(): Theme {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    const sync = () => setThemeState(themeFromDocument());
    sync();
    window.addEventListener(themeEvent, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(themeEvent, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return theme;
}

/** "Modo escuro" switch: on = dark (the default), off = light. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  const dark = theme === "dark";
  return (
    <button
      aria-checked={dark}
      aria-label="Modo escuro"
      className={`theme-toggle${dark ? " is-dark" : ""}${compact ? " compact" : ""}`}
      onClick={() => setTheme(dark ? "light" : "dark")}
      role="switch"
      title={dark ? "Mudar para o modo claro" : "Mudar para o modo escuro"}
      type="button"
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-thumb">
          {dark ? <Moon size={11} strokeWidth={2.4} /> : <Sun size={11} strokeWidth={2.4} />}
        </span>
      </span>
      {compact ? null : <span className="theme-toggle-label">Modo escuro</span>}
    </button>
  );
}
