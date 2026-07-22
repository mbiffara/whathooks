"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";

const COOKIE = "NEXT_LOCALE";

export function setLocaleCookie(locale: string) {
  const maxAge = 365 * 24 * 60 * 60; // 1 year
  document.cookie = `${COOKIE}=${locale}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

/** EN/ES toggle. Writes the locale cookie and re-renders the tree. */
export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();

  function switchTo(next: string) {
    if (next === locale) return;
    setLocaleCookie(next);
    router.refresh();
  }

  return (
    <div
      className="flex items-center gap-1 text-xs font-medium"
      aria-label="Language"
    >
      {(["en", "es"] as const).map((l) => (
        <button
          key={l}
          onClick={() => switchTo(l)}
          className={
            l === locale
              ? "rounded-md bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[var(--color-fg)]"
              : "px-1.5 py-0.5 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          }
          aria-current={l === locale ? "true" : undefined}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
