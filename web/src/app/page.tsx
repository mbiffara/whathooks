import { GoogleAnalytics } from "@/components/google-analytics";
import { AdClickTracker } from "@/components/ad-click-tracker";
import { BrandStrip } from "@/components/brand-strip";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { useTranslations } from "next-intl";
import Link from "next/link";
import Script from "next/script";

const inboundPayload = `{
  "event": "message.received",
  "sessionId": "sess_8f2k19a7",
  "data": {
    "id": "msg_3aZ9k1",
    "from": "15551234567",
    "pushName": "Ana Pereira",
    "type": "text",
    "text": "Hi! Is my order shipped yet?",
    "waMessageId": "3EB0X9F2A1B7C4D6E8",
    "timestamp": 1751212800
  },
  "timestamp": 1751212800
}`;

const replySnippet = `curl -X POST https://api.whathooks.com/v1/messages \\
  -H "X-API-Key: wh_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "sessionId": "sess_8f2k19a7",
    "to": "15551234567",
    "text": "Hello! Yes, it shipped this morning."
  }'`;

const FEATURE_ICONS = ["📷", "🔐", "✉️", "📱", "🔁", "⚡"];

/** Plan names and prices are shared across locales; copy lives in messages. */
const PLAN_META = [
  {
    key: "starter",
    name: "Starter",
    price: "$8.99",
    annualPrice: "$89.90",
    highlighted: false,
  },
  {
    key: "pro",
    name: "Pro",
    price: "$24.99",
    annualPrice: "$249.90",
    highlighted: true,
  },
  {
    key: "business",
    name: "Business",
    price: "$79.99",
    annualPrice: "$799.90",
    highlighted: false,
  },
];

export default function Home() {
  const t = useTranslations("landing");
  const steps = t.raw("steps") as { title: string; desc: string }[];
  const features = (t.raw("features") as { title: string; desc: string }[]).map(
    (f, i) => ({ ...f, icon: FEATURE_ICONS[i] }),
  );
  const plans = PLAN_META.map((meta) => ({
    ...meta,
    ...(t.raw(`plans.${meta.key}`) as {
      desc: string;
      cta: string;
      items: string[];
    }),
  }));
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
      {/* Structured data for search: what whathooks is, and its price range. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "whathooks",
            url: "https://www.whathooks.app",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            description:
              "Connect your WhatsApp number via QR: AI agents reply in your voice, your team steps in from their own WhatsApp, and flows route every message. Team inbox, contacts and a full API included.",
            offers: {
              "@type": "AggregateOffer",
              lowPrice: "8.99",
              highPrice: "79.99",
              priceCurrency: "USD",
            },
            publisher: {
              "@type": "Organization",
              name: "logicalminds",
              url: "https://logicalminds.co",
            },
          }),
        }}
      />
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="grid items-center gap-14 md:grid-cols-2">
            <div>
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
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
                  {t("connectCta")}
                </Link>
                <Link href="/getting-started" className="btn-ghost">
                  {t("heroGuideCta")}
                </Link>
              </div>
              <p className="mt-5 text-sm text-[var(--color-muted)]">
                {t("setupNote")}
              </p>
            </div>

            {/* The lead → AI → human story */}
            <div className="card border-[var(--color-border)] bg-[var(--color-surface)]/80 p-6 md:p-7">
              <p className="mb-5 text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
                {t("storyLabel")}
              </p>
              <div className="flex flex-col gap-3">
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                    {t("storyLeadTag")}
                  </p>
                  <p className="mt-2 max-w-[85%] rounded-lg rounded-bl-none bg-[var(--color-bg)] px-3 py-2 text-xs">
                    {t("storyLead")}
                  </p>
                </div>

                <div className="flex justify-center text-[var(--color-muted)]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 4v16m0 0l-5-5m5 5l5-5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>

                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-brand)]">
                    🤖 {t("storyAiTag")}
                  </p>
                  <p className="mt-2 ml-auto max-w-[85%] rounded-lg rounded-br-none bg-[var(--color-brand)]/15 px-3 py-2 text-xs">
                    {t("storyAi")}
                  </p>
                </div>

                <div className="flex justify-center text-[var(--color-muted)]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 4v16m0 0l-5-5m5 5l5-5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>

                <div className="rounded-xl border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/5 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-brand)]">
                    👥 {t("storyHumanTag")}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted)]">
                    {t("storyHuman")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <BrandStrip />

        {/* Flows — the visual router */}
        <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t("flowsTitle")}
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">{t("flowsDesc")}</p>
          </div>
          <div className="card mt-12 overflow-x-auto p-6 md:p-8">
            <div className="flex min-w-[640px] items-center gap-3">
              {(["flowNode1", "flowNode2", "flowNode3"] as const).map(
                (key, i) => (
                  <div key={key} className="flex flex-1 items-center gap-3">
                    <div
                      className={`flex-1 rounded-xl border px-4 py-3 text-center text-sm font-medium ${
                        i === 0
                          ? "border-[var(--color-brand)]/40 bg-[var(--color-brand)]/5"
                          : "border-[var(--color-border)] bg-[var(--color-surface-2)]"
                      }`}
                    >
                      {t(key)}
                    </div>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="shrink-0 text-[var(--color-muted)]"
                    >
                      <path
                        d="M4 12h16m0 0l-5-5m5 5l-5 5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                ),
              )}
              <div className="flex-1 rounded-xl border border-[var(--color-brand)]/40 bg-[var(--color-brand)]/5 px-4 py-3 text-center text-sm font-medium">
                👥 {t("flowNode4")}
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {(["flowsChip1", "flowsChip2", "flowsChip3"] as const).map(
                (key) => (
                  <span key={key} className="pill">
                    {t(key)}
                  </span>
                ),
              )}
            </div>
          </div>
        </section>

        {/* Mirror groups — the handoff mechanic */}
        <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {t("mirrorTitle")}
              </h2>
              <p className="mt-3 text-[var(--color-muted)]">
                {t("mirrorDesc")}
              </p>
              <ul className="mt-6 flex flex-col gap-3 text-sm">
                {(["mirrorPoint1", "mirrorPoint2", "mirrorPoint3"] as const).map(
                  (key) => (
                    <li key={key} className="flex items-start gap-2">
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
                      <span className="text-[var(--color-muted)]">
                        {t(key)}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </div>
            <div className="card border-[var(--color-border)] bg-[var(--color-surface)]/80 p-5">
              <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-brand)]/15 text-sm">
                  👥
                </span>
                <span className="text-sm font-semibold">
                  {t("mirrorGroupName")}
                </span>
              </div>
              <div className="mt-4 flex flex-col gap-3">
                <div>
                  <p className="max-w-[85%] rounded-lg rounded-bl-none bg-[var(--color-surface-2)] px-3 py-2 text-xs">
                    {t("mirrorMsg1")}
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--color-muted)]">
                    {t("mirrorMsg1Tag")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="ml-auto max-w-[85%] rounded-lg rounded-br-none bg-[var(--color-brand)]/15 px-3 py-2 text-left text-xs">
                    {t("mirrorMsg2")}
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--color-muted)]">
                    {t("mirrorMsg2Tag")}
                  </p>
                </div>
                <p className="mt-2 rounded-lg border border-dashed border-[var(--color-brand)]/40 px-3 py-2 text-center text-[11px] text-[var(--color-brand)]">
                  {t("mirrorMsg3")}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Dashboard inbox + teams */}
        <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t("notJustApi")}
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">
              {t("notJustApiDesc")}
            </p>
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            {/* Team inbox */}
            <div className="card transition-colors hover:border-[var(--color-brand)]/40">
              <h3 className="text-lg font-semibold">{t("inboxTitle")}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
                {t("inboxDesc")}
              </p>
              <div className="mt-6 flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                <div className="max-w-[80%] self-start rounded-lg rounded-bl-none bg-[var(--color-bg)] px-3 py-2 text-xs">
                  {t("chatIn")}
                </div>
                <div className="max-w-[80%] self-end rounded-lg rounded-br-none bg-[var(--color-brand)]/15 px-3 py-2 text-xs">
                  {t("chatOut")}
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
                  <span className="flex-1 text-xs text-[var(--color-muted)]">
                    {t("typeReply")}
                  </span>
                  <span className="rounded-md bg-[var(--color-brand)] px-2 py-1 text-[10px] font-semibold text-[var(--color-on-brand)]">
                    {t("sendBtn")}
                  </span>
                </div>
              </div>
            </div>

            {/* Teams */}
            <div className="card transition-colors hover:border-[var(--color-brand)]/40">
              <h3 className="text-lg font-semibold">{t("teamsTitle")}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
                {t("teamsDesc")}
              </p>
              <div className="mt-6 flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                {[
                  { name: "Ana Pereira", role: t("roleOwner") },
                  { name: "Luis Gómez", role: t("roleAdmin") },
                  { name: "Sam Chen", role: t("roleMember") },
                ].map((member) => (
                  <div
                    key={member.name}
                    className="flex items-center justify-between rounded-lg bg-[var(--color-bg)] px-3 py-2"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--color-brand)]/15 text-[10px] font-bold text-[var(--color-brand)]">
                        {member.name
                          .split(" ")
                          .map((part) => part[0])
                          .join("")}
                      </span>
                      <span className="text-xs font-medium">{member.name}</span>
                    </div>
                    <span className="pill">{member.role}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t("howItWorks")}
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">
              {t("howItWorksDesc")}
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {steps.map((step, i) => (
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

        {/* Features */}
        <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t("featuresTitle")}
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">
              {t("featuresDesc")}
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="card transition-colors hover:border-[var(--color-brand)]/40"
              >
                <div className="grid h-11 w-11 place-items-center rounded-lg bg-[var(--color-surface-2)] text-xl">
                  <span aria-hidden>{feature.icon}</span>
                </div>
                <h3 className="mt-4 text-base font-semibold">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Code showcase */}
        <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t("apiTitle")}
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">{t("apiDesc")}</p>
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <div className="card">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("inboundWebhook")}</h3>
                <span className="badge bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                  {t("yourEndpoint")}
                </span>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-[var(--color-surface-2)] p-4 font-mono text-xs leading-relaxed text-[var(--color-fg)]">
                <code>{inboundPayload}</code>
              </pre>
            </div>
            <div className="card">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("sendReply")}</h3>
                <span className="badge bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                  POST · /v1/messages
                </span>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-[var(--color-surface-2)] p-4 font-mono text-xs leading-relaxed text-[var(--color-accent)]">
                <code>{replySnippet}</code>
              </pre>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/developers" className="btn-ghost">
              {t("devPageCta")}
            </Link>
            <Link href="/docs" className="btn-ghost">
              {t("readDocs")}
            </Link>
          </div>
        </section>

        {/* Pricing */}
        <section
          id="pricing"
          className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16 md:py-24"
        >
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t("pricingTitle")}
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">{t("pricingDesc")}</p>
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
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
                  {plan.highlighted && (
                    <span className="badge bg-[var(--color-brand)]/15 text-[var(--color-brand)]">
                      {t("mostPopular")}
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-sm text-[var(--color-muted)]">
                    {t("perMonth")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  {t("annualNote", { price: plan.annualPrice })}
                </p>
                <p className="mt-1.5 text-xs font-medium text-[var(--color-brand)]">
                  {t("trialNote")}
                </p>
                <p className="mt-2 text-sm text-[var(--color-muted)]">
                  {plan.desc}
                </p>
                <ul className="mt-6 flex flex-col gap-2.5 text-sm">
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
                <div className="mt-8 flex-1" />
                <Link
                  href="/signup"
                  className={
                    plan.highlighted ? "btn-primary w-full" : "btn-ghost w-full"
                  }
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-[var(--color-muted)]">
            {t.rich("pricingFootnote", {
              link: (c) => (
                <a
                  href="mailto:hello@logicalminds.co"
                  className="text-[var(--color-brand)] hover:underline"
                >
                  {c}
                </a>
              ),
            })}
          </p>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-6xl px-6 pb-24 pt-4">
          <div className="card overflow-hidden border-[var(--color-brand)]/30 bg-[var(--color-surface)] px-6 py-14 text-center md:px-12 md:py-16">
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              {t("ctaTitle")}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[var(--color-muted)]">
              {t("ctaDesc")}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/signup" className="btn-primary">
                {t("connectCta")}
              </Link>
              <Link href="/docs" className="btn-ghost">
                {t("readDocs")}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
