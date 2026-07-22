import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LocaleSwitcher } from "./locale-switcher";
import { Logo } from "./logo";

export async function SiteHeader() {
  const t = await getTranslations("nav");
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <nav className="flex items-center gap-2 text-sm">
          <Link
            href="/docs"
            className="px-3 py-2 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            {t("docs")}
          </Link>
          <Link
            href="/#pricing"
            className="px-3 py-2 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            {t("pricing")}
          </Link>
          <Link
            href="/signin"
            className="px-3 py-2 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            {t("signIn")}
          </Link>
          <Link href="/signup" className="btn-primary">
            {t("getStarted")}
          </Link>
          <LocaleSwitcher />
        </nav>
      </div>
    </header>
  );
}
