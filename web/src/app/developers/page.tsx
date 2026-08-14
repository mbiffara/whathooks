import { GoogleAnalytics } from "@/components/google-analytics";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { useTranslations } from "next-intl";
import Link from "next/link";

const CARDS = ["webhooks", "send", "mapping", "keys"] as const;

const inboundSnippet = `POST https://your-app.com/webhooks/whatsapp
X-Whathooks-Event: message.received
X-Whathooks-Signature: sha256=2f7a…

{
  "event": "message.received",
  "sessionId": "sess_8f2a…",
  "data": { "from": "5491155551234", "text": "Hola!" },
  "timestamp": "2026-08-07T12:00:00.000Z"
}`;

const sendSnippet = `curl -X POST https://api.whathooks.app/v1/messages \\
  -H "X-API-Key: wh_live_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "sessionId": "sess_8f2a…",
        "to": "5491155551234",
        "text": "¡Hola!" }'`;

/** The developer-facing pitch: webhooks in, REST out, signed everything. */
export default function DevelopersPage() {
  const t = useTranslations("developers");
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
            <Link href="/docs" className="btn-primary">
              {t("docsCta")}
            </Link>
            <Link href="/signup" className="btn-ghost">
              {t("signupCta")}
            </Link>
          </div>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-2">
          <div className="card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t("inboundTitle")}</h2>
              <span className="pill">message.received</span>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-[var(--color-surface-2)] p-4 font-mono text-xs leading-relaxed text-[var(--color-fg)]">
              <code>{inboundSnippet}</code>
            </pre>
          </div>
          <div className="card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t("sendTitle")}</h2>
              <span className="pill">POST /v1/messages</span>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-[var(--color-surface-2)] p-4 font-mono text-xs leading-relaxed text-[var(--color-accent)]">
              <code>{sendSnippet}</code>
            </pre>
          </div>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {CARDS.map((key) => (
            <div
              key={key}
              className="card transition-colors hover:border-[var(--color-brand)]/40"
            >
              <h2 className="text-base font-semibold">
                {t(`cards.${key}.title`)}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
                {t(`cards.${key}.desc`)}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-sm text-[var(--color-muted)]">
          {t("eventsNote")}{" "}
          <Link
            href="/docs"
            className="text-[var(--color-brand)] hover:underline"
          >
            {t("eventsNoteLink")}
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
