"use client";

import { useEffect, useState } from "react";

const COOKIE = "THEME";
export type ThemePref = "system" | "light" | "dark";

export function setThemePref(pref: ThemePref) {
  if (pref === "system") {
    document.cookie = `${COOKIE}=; path=/; max-age=0`;
    delete document.documentElement.dataset.theme;
  } else {
    const maxAge = 365 * 24 * 60 * 60; // 1 year
    document.cookie = `${COOKIE}=${pref}; path=/; max-age=${maxAge}; SameSite=Lax`;
    document.documentElement.dataset.theme = pref;
  }
}

export function getThemePref(): ThemePref {
  const m = document.cookie.match(/(?:^|;\s*)THEME=(light|dark)/);
  return (m?.[1] as ThemePref) ?? "system";
}

function effectiveTheme(): "light" | "dark" {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/**
 * Sun/moon button. Clicking pins the OPPOSITE of the currently effective
 * theme as an explicit choice (cookie + data-theme); the OS preference is
 * the default until then and can be restored from Settings.
 */
export function ThemeToggle() {
  // Render nothing until mounted — the effective theme isn't knowable on
  // the server when no cookie is set (OS preference lives in CSS only).
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    setTheme(effectiveTheme());
  }, []);

  if (!theme) return <span className="w-8" aria-hidden />;

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setThemePref(next);
    setTheme(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label={
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
      }
      className="grid h-8 w-8 place-items-center rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
