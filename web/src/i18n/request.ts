import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Best supported locale from an Accept-Language header, by q-weight. */
function fromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? parseFloat(q) || 0 : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0] as Locale;
    if (LOCALES.includes(base)) return base;
  }
  return null;
}

/**
 * Cookie-based locale (no URL routing): the header switcher and the account
 * setting both write NEXT_LOCALE. First-time visitors (no cookie yet) fall
 * back to their browser language so e.g. Spanish ad traffic lands in Spanish.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  let locale = LOCALES.includes(raw as Locale) ? (raw as Locale) : null;
  if (!locale) {
    const h = await headers();
    locale = fromAcceptLanguage(h.get("accept-language"));
  }
  locale ??= DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
