import { GoogleAnalytics } from "@/components/google-analytics";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { useTranslations } from "next-intl";
import Link from "next/link";

const BLOCKS = ["flows", "agents", "handoff", "runs"] as const;

/** Automation deep-dive for the SMB audience (flows + AI + handoff). */
export default function AutomationPage() {
  const t = useTranslations("automation");
  return (
    <>
      <GoogleAnalytics />
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-[var(--color-muted)]">
            {t("intro")}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="btn-primary">
              {t("cta")}
            </Link>
            <Link href="/getting-started" className="btn-ghost">
              {t("guideCta")}
            </Link>
          </div>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-2">
          {BLOCKS.map((key) => {
            const points = t.raw(`blocks.${key}.points`) as string[];
            return (
              <div
                key={key}
                className="card transition-colors hover:border-[var(--color-brand)]/40"
              >
                <h2 className="text-lg font-semibold">
                  {t(`blocks.${key}.title`)}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
                  {t(`blocks.${key}.desc`)}
                </p>
                <ul className="mt-4 flex flex-col gap-2 text-sm">
                  {points.map((p, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        className="mt-0.5 shrink-0 text-[var(--color-brand)]"
                      >
                        <path
                          d="M5 13l4 4L19 7"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="text-[var(--color-muted)]">{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="card mt-16 border-[var(--color-brand)]/30 px-6 py-12 text-center md:px-12">
          <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">
            {t("bottomTitle")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-[var(--color-muted)]">
            {t("bottomDesc")}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="btn-primary">
              {t("cta")}
            </Link>
            <Link href="/#pricing" className="btn-ghost">
              {t("pricingCta")}
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
