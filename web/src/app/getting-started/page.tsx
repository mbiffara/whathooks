import { GoogleAnalytics } from "@/components/google-analytics";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { useTranslations } from "next-intl";
import Link from "next/link";

/** Section ids double as anchor targets; copy lives in messages (guide.*). */
const SECTIONS = [
  "connect",
  "inbox",
  "contacts",
  "aiAgents",
  "humanAgents",
  "flows",
  "team",
] as const;

/** Non-technical product walkthrough — the developer docs live at /docs. */
export default function GettingStartedPage() {
  const t = useTranslations("guide");
  return (
    <>
      <GoogleAnalytics />
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="mt-3 text-[var(--color-muted)]">{t("intro")}</p>

        <nav className="mt-6 flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <a
              key={s}
              href={`#${s}`}
              className="pill hover:border-[var(--color-brand)]/50"
            >
              {t(`sections.${s}.title`)}
            </a>
          ))}
        </nav>

        {SECTIONS.map((s) => {
          const paragraphs = t.raw(`sections.${s}.paragraphs`) as string[];
          const items = t.raw(`sections.${s}.items`) as string[];
          return (
            <section key={s} id={s} className="mt-12 scroll-mt-24">
              <h2 className="text-xl font-semibold">
                {t(`sections.${s}.title`)}
              </h2>
              {paragraphs.map((p, i) => (
                <p
                  key={i}
                  className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]"
                >
                  {p}
                </p>
              ))}
              {items.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5 text-sm text-[var(--color-muted)]">
                  {items.map((it, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-[var(--color-brand)]">•</span>
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        <div className="mt-14 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-muted)]">
          {t("outro")}{" "}
          <Link
            href="/docs"
            className="text-[var(--color-brand)] hover:underline"
          >
            {t("outroDocsLink")}
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
