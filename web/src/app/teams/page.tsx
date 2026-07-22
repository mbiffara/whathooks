import { AdClickTracker } from "@/components/ad-click-tracker";
import { BrandStrip } from "@/components/brand-strip";
import { GoogleAnalytics } from "@/components/google-analytics";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import Script from "next/script";

export async function generateMetadata() {
  const t = await getTranslations("teams.meta");
  return { title: t("title"), description: t("description") };
}

const AVATARS = ["AP", "CR", "SM"];

export default function TeamsPage() {
  const t = useTranslations("teams");
  const pains = t.raw("pains") as { title: string; desc: string }[];
  const after = t.raw("after") as { title: string; desc: string }[];
  const how = t.raw("how") as { title: string; desc: string }[];

  interface TeamsPlan {
    name: string;
    price: string;
    tagline: string;
    items: string[];
    cta: string;
    badge?: string;
  }
  const plans: (TeamsPlan & { highlighted: boolean })[] = [
    { ...(t.raw("pricingStarter") as TeamsPlan), highlighted: false },
    { ...(t.raw("pricingPro") as TeamsPlan), highlighted: true },
  ];

  const conversations = [
    {
      initials: "AP",
      name: t("convo1Name"),
      preview: t("convo1Preview"),
      unread: 2,
      active: true,
    },
    {
      initials: "CR",
      name: t("convo2Name"),
      preview: t("convo2Preview"),
      unread: 1,
      active: false,
    },
    {
      initials: "SM",
      name: t("convo3Name"),
      preview: t("convo3Preview"),
      unread: 0,
      active: false,
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <GoogleAnalytics />
      {/* X (Twitter) conversion tracking base code */}
      <Script id="x-pixel" strategy="afterInteractive">
        {`!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);
},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
twq('config','re0yu');`}
      </Script>
      <AdClickTracker />
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="grid items-center gap-14 lg:grid-cols-2">
            <div>
              <span className="badge border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)]" />
                {t("eyebrow")}
              </span>
              <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
                {t.rich("heroTitle", {
                  brand: (c) => (
                    <span className="text-[var(--color-brand)]">{c}</span>
                  ),
                })}
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-muted)]">
                {t("heroSubtitle")}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/signup" className="btn-primary">
                  {t("ctaPrimary")}
                </Link>
                <a href="#how" className="btn-ghost">
                  {t("ctaSecondary")}
                </a>
              </div>
              <p className="mt-5 text-sm text-[var(--color-muted)]">
                {t("heroNote")}
              </p>
            </div>

            {/* Inbox mockup */}
            <div className="card overflow-hidden border-[var(--color-border)] bg-[var(--color-surface)]/80 p-0">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
                <span className="text-sm font-semibold">
                  {t("inboxHeader")}
                </span>
                <span className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  <span className="flex -space-x-1.5">
                    {AVATARS.map((a) => (
                      <span
                        key={a}
                        className="grid h-5 w-5 place-items-center rounded-full border border-[var(--color-surface)] bg-[var(--color-brand)]/20 text-[8px] font-bold text-[var(--color-brand)]"
                      >
                        {a}
                      </span>
                    ))}
                  </span>
                  {t("onlineNow")}
                </span>
              </div>
              <div className="grid sm:grid-cols-[180px_1fr]">
                {/* Conversation list */}
                <div className="hidden border-r border-[var(--color-border)] sm:block">
                  <div className="border-b border-[var(--color-border)] px-3 py-2 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                    {t("allSessions")}
                  </div>
                  {conversations.map((c) => (
                    <div
                      key={c.name}
                      className={`flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2.5 ${
                        c.active ? "bg-[var(--color-surface-2)]" : ""
                      }`}
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--color-surface-2)] text-[9px] font-bold uppercase text-[var(--color-brand)]">
                        {c.initials}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          {c.name}
                        </span>
                        <span className="block truncate text-[10px] text-[var(--color-muted)]">
                          {c.preview}
                        </span>
                      </span>
                      {c.unread > 0 && (
                        <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[var(--color-brand)] px-1 text-[9px] font-semibold text-[var(--color-on-brand)]">
                          {c.unread}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {/* Thread */}
                <div className="flex flex-col gap-2 bg-[var(--color-bg)] p-4">
                  <div className="max-w-[85%] self-start rounded-lg rounded-bl-none border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs">
                    {t("threadIn1")}
                  </div>
                  <div className="max-w-[85%] self-end rounded-lg rounded-br-none border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/15 px-3 py-2 text-xs">
                    <span className="mb-0.5 block text-[9px] font-semibold text-[var(--color-brand)]">
                      {t("threadOut1Author")}
                    </span>
                    {t("threadOut1")}
                  </div>
                  <div className="max-w-[85%] self-end rounded-lg rounded-br-none border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/15 px-3 py-2 text-xs">
                    <span className="mb-0.5 block text-[9px] font-semibold text-[var(--color-brand)]">
                      {t("threadOut2Author")}
                    </span>
                    {t("threadOut2")}
                  </div>
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                    <span className="flex-1 text-xs text-[var(--color-muted)]">
                      {t("typingLabel")}
                    </span>
                    <span className="rounded-md bg-[var(--color-brand)] px-2 py-1 text-[10px] font-semibold text-[var(--color-on-brand)]">
                      {t("sendLabel")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <BrandStrip />

        {/* Pains */}
        <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t("painsTitle")}
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">
              {t("painsSubtitle")}
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {pains.map((pain) => (
              <div key={pain.title} className="card">
                <h3 className="text-lg font-semibold">{pain.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
                  {pain.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* After / features */}
        <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t("afterTitle")}
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">
              {t("afterSubtitle")}
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {after.map((item) => (
              <div
                key={item.title}
                className="card transition-colors hover:border-[var(--color-brand)]/40"
              >
                <h3 className="text-base font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section
          id="how"
          className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16 md:py-24"
        >
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t("howTitle")}
            </h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {how.map((step, i) => (
              <div key={step.title} className="card">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--color-brand)] text-base font-bold text-[var(--color-on-brand)]">
                  {i + 1}
                </div>
                <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t("pricingTitle")}
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">
              {t("pricingSubtitle")}
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:mx-auto lg:max-w-4xl">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`card flex flex-col ${
                  plan.highlighted
                    ? "border-[var(--color-brand)]/60 shadow-[0_0_40px_-12px_var(--color-brand)]"
                    : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold">{plan.name}</h3>
                  {plan.badge && (
                    <span className="badge bg-[var(--color-brand)]/15 text-[var(--color-brand)]">
                      {plan.badge}
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-sm text-[var(--color-muted)]">
                    {t("perMonth")}
                  </span>
                </div>
                <p className="mt-1.5 text-xs font-medium text-[var(--color-brand)]">
                  {t("trialNote")}
                </p>
                <p className="mt-2 text-sm text-[var(--color-muted)]">
                  {plan.tagline}
                </p>
                <ul className="mt-6 flex flex-1 flex-col gap-2.5 text-sm">
                  {plan.items.map((item) => (
                    <li key={item} className="flex items-start gap-2">
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
                      <span className="text-[var(--color-muted)]">{item}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={`mt-8 w-full ${
                    plan.highlighted ? "btn-primary" : "btn-ghost"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-[var(--color-muted)]">
            {t("pricingFootnote")}
          </p>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-6xl px-6 pb-24 pt-4">
          <div className="card overflow-hidden border-[var(--color-brand)]/30 bg-[var(--color-surface)] px-6 py-14 text-center md:px-12 md:py-16">
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              {t("ctaTitle")}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[var(--color-muted)]">
              {t("ctaSubtitle")}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/signup" className="btn-primary">
                {t("ctaButton")}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
