import { useTranslations } from "next-intl";
import Link from "next/link";
import { Logo } from "./logo";

export function SiteFooter() {
  const t = useTranslations("nav");
  return (
    <footer className="border-t border-[var(--color-border)] py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 text-sm text-[var(--color-muted)] sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <div className="flex gap-5">
          <Link prefetch={false} href="/docs" className="hover:text-[var(--color-fg)]">
            {t("docs")}
          </Link>
          <Link prefetch={false} href="/teams" className="hover:text-[var(--color-fg)]">
            {t("forTeams")}
          </Link>
          <Link prefetch={false} href="/signin" className="hover:text-[var(--color-fg)]">
            {t("signIn")}
          </Link>
          <Link prefetch={false} href="/terms" className="hover:text-[var(--color-fg)]">
            {t("terms")}
          </Link>
          <Link prefetch={false} href="/privacy" className="hover:text-[var(--color-fg)]">
            {t("privacy")}
          </Link>
        </div>
        <span>
          © {new Date().getFullYear()} whathooks · {t("poweredBy")}{" "}
          <a
            href="https://logicalminds.co"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--color-fg)]"
          >
            logicalminds
          </a>
        </span>
      </div>
    </footer>
  );
}
