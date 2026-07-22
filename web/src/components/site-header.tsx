import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LocaleSwitcher } from "./locale-switcher";
import { Logo } from "./logo";

export async function SiteHeader() {
  const t = await getTranslations("nav");
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        {/* shrink-0: a squeezed logo paints its text over the nav */}
        <span className="shrink-0">
          <Logo />
        </span>
        {/* Phones show logo + CTA; links and the switcher return at sm
            (pricing lives on the page, locale auto-detects, and signin is
            reachable from the signup page and footer). */}
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <Link
            href="/docs"
            className="hidden px-3 py-2 text-[var(--color-muted)] hover:text-[var(--color-fg)] sm:block"
          >
            {t("docs")}
          </Link>
          <Link
            href="/#pricing"
            className="hidden px-3 py-2 text-[var(--color-muted)] hover:text-[var(--color-fg)] sm:block"
          >
            {t("pricing")}
          </Link>
          <Link
            href="/signin"
            className="hidden whitespace-nowrap px-3 py-2 text-[var(--color-muted)] hover:text-[var(--color-fg)] sm:block"
          >
            {t("signIn")}
          </Link>
          <Link href="/signup" className="btn-primary whitespace-nowrap">
            {t("getStarted")}
          </Link>
          <span className="hidden sm:block">
            <LocaleSwitcher />
          </span>
        </nav>
      </div>
    </header>
  );
}
