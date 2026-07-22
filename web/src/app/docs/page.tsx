import { GoogleAnalytics } from "@/components/google-analytics";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";

const NAV_IDS = [
  { id: "introduction", key: "introduction" },
  { id: "quickstart", key: "quickstart" },
  { id: "connecting", key: "connecting" },
  { id: "webhooks", key: "webhooks" },
  { id: "sending", key: "sending" },
  { id: "api-reference", key: "apiReference" },
  { id: "errors", key: "errors" },
];

const SESSION_STATUSES = [
  "PENDING",
  "QR",
  "CONNECTING",
  "CONNECTED",
  "DISCONNECTED",
  "LOGGED_OUT",
] as const;

const EVENTS = [
  { name: "message.received", key: "messageReceived" },
  { name: "session.status", key: "sessionStatus" },
  { name: "session.qr", key: "sessionQr" },
];

const HEADERS = [
  { name: "X-Whathooks-Event", key: "event" },
  { name: "X-Whathooks-Signature", key: "signature" },
  { name: "X-Whathooks-Delivery", key: "delivery" },
];

const endpoints = [
  { method: "POST", path: "/v1/auth/register", auth: "public" },
  { method: "POST", path: "/v1/auth/login", auth: "public" },
  { method: "GET", path: "/v1/sessions", auth: "jwtOrKey" },
  { method: "POST", path: "/v1/sessions", auth: "jwtOrKey" },
  { method: "GET", path: "/v1/sessions/:id", auth: "jwtOrKey" },
  { method: "POST", path: "/v1/sessions/:id/logout", auth: "jwtOrKey" },
  { method: "GET", path: "/v1/webhooks", auth: "jwtOrKey" },
  { method: "POST", path: "/v1/webhooks", auth: "jwtOrKey" },
  { method: "POST", path: "/v1/messages", auth: "key" },
  { method: "GET", path: "/v1/messages", auth: "jwtOrKey" },
];

const verifyExample = `import crypto from "crypto";

// Mount with the raw body, e.g. express.raw({ type: "application/json" })
function verifySignature(rawBody, header, secret) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // Header arrives as "sha256=<hex>" — strip the prefix first
  const received = (header || "").replace(/^sha256=/, "");

  const a = Buffer.from(received, "hex");
  const b = Buffer.from(expected, "hex");

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`;

const embedQrExample = `# 1. Create a session (starts pairing, a QR is generated)
curl -X POST https://api.whathooks.com/v1/sessions \\
  -H "X-API-Key: wh_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "label": "customer-42" }'
# → { "id": "sess_8f2k19a7", "status": "PENDING", ... }

# 2. Poll until status is "QR", then embed the code in your UI
curl https://api.whathooks.com/v1/sessions/sess_8f2k19a7 \\
  -H "X-API-Key: wh_live_..."
# → { "status": "QR", "qrDataUrl": "data:image/png;base64,...", ... }

# 3. Your user scans it with WhatsApp → status becomes "CONNECTED"`;

const mappingExample = `// Mapping rules on the webhook:
[
  { "target": "phone",      "source": "data.from" },
  { "target": "message",    "source": "data.text" },
  { "target": "receivedAt", "source": "data.timestamp",
    "dateFormat": "yyyy-MM-dd HH:mm" },
  { "target": "origin",     "value": "whathooks" }
]

// What your endpoint receives:
{
  "event": "message.received",
  "sessionId": "sess_8f2k19a7",
  "data": {
    "phone": "15551234567",
    "message": "Hi! Is my order shipped yet?",
    "receivedAt": "2026-07-14 19:30",
    "origin": "whathooks"
  },
  "timestamp": "2026-07-14T22:30:00.000Z"
}`;

const payloadExample = `{
  "event": "message.received",
  "sessionId": "sess_8f2a...",
  "data": {
    "id": "msg_3c91...",
    "sessionId": "sess_8f2a...",
    "from": "15551234567",
    "pushName": "Jane Doe",
    "type": "text",
    "text": "Hi there!",
    "waMessageId": "3EB0A1B2C3D4E5F6",
    "timestamp": "2026-06-29T14:21:07.000Z"
  },
  "timestamp": "2026-06-29T14:21:07.412Z"
}`;

const sendCurl = `curl -X POST https://api.whathooks.com/v1/messages \\
  -H "X-API-Key: wh_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sessionId": "sess_8f2a...",
    "to": "15551234567",
    "text": "Hello"
  }'`;

const sendResponse = `{
  "id": "msg_5d72...",
  "waMessageId": "3EB0F1E2D3C4B5A6",
  "sessionId": "sess_8f2a...",
  "to": "15551234567",
  "status": "sent"
}`;

export default function DocsPage() {
  const t = useTranslations("docs");
  // Shared rich-text tags for the prose blocks.
  const rich = {
    pill: (c: ReactNode) => <code className="pill">{c}</code>,
    hl: (c: ReactNode) => (
      <span className="font-medium text-[var(--color-fg)]">{c}</span>
    ),
    em: (c: ReactNode) => <em>{c}</em>,
    // Literal code fragments that would clash with ICU syntax live here.
    imgtag: () => <code className="pill">{`<img src={qrDataUrl} />`}</code>,
    envtag: () => (
      <code className="pill">{`{ event, sessionId, data, timestamp }`}</code>
    ),
    apikeytag: () => <code className="pill">X-API-Key: &lt;token&gt;</code>,
    bearertag: () => (
      <code className="pill">Authorization: Bearer &lt;token&gt;</code>
    ),
  };
  return (
    <>
      <GoogleAnalytics />
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
          <aside className="hidden lg:block">
            <nav className="lg:sticky lg:top-20 space-y-1 text-sm">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                {t("docsLabel")}
              </p>
              {NAV_IDS.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="block rounded-md px-3 py-2 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                >
                  {t(`nav.${item.key}`)}
                </a>
              ))}
            </nav>
          </aside>

          <div className="max-w-3xl">
            <div className="mb-8">
              <span className="badge bg-[var(--color-surface-2)] text-[var(--color-accent)]">
                {t("badge")}
              </span>
              <h1 className="mt-4 text-4xl font-bold tracking-tight">
                {t("title")}
              </h1>
              <p className="mt-3 text-[var(--color-muted)]">{t("subtitle")}</p>
            </div>

            {/* Introduction */}
            <section id="introduction">
              <h2 className="mt-12 mb-4 text-2xl font-bold">
                {t("introTitle")}
              </h2>
              <p className="text-[var(--color-muted)]">{t("introP1")}</p>
              <ul className="mt-4 space-y-2 text-[var(--color-muted)]">
                <li>{t.rich("introInbound", rich)}</li>
                <li>{t.rich("introOutbound", rich)}</li>
              </ul>
              <p className="mt-4 text-[var(--color-muted)]">{t("introP2")}</p>
              <div className="card mt-6 border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-muted)]">
                {t("introNote")}
              </div>
            </section>

            {/* Quickstart */}
            <section id="quickstart">
              <h2 className="mt-12 mb-4 text-2xl font-bold">
                {t("quickstartTitle")}
              </h2>
              <p className="text-[var(--color-muted)]">
                {t("quickstartIntro")}
              </p>
              <ol className="mt-4 space-y-4">
                <li className="card">
                  <h3 className="text-lg font-semibold">{t("qs1Title")}</h3>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    {t("qs1Desc")}
                  </p>
                </li>
                <li className="card">
                  <h3 className="text-lg font-semibold">{t("qs2Title")}</h3>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    {t.rich("qs2Desc", rich)}
                  </p>
                </li>
                <li className="card">
                  <h3 className="text-lg font-semibold">{t("qs3Title")}</h3>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    {t.rich("qs3Desc", rich)}
                  </p>
                </li>
                <li className="card">
                  <h3 className="text-lg font-semibold">{t("qs4Title")}</h3>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    {t.rich("qs4Desc", rich)}
                  </p>
                </li>
              </ol>
              <div className="mt-6">
                <Link href="/signup" className="btn-primary">
                  {t("createAccount")}
                </Link>
              </div>
            </section>

            {/* Connecting a number */}
            <section id="connecting">
              <h2 className="mt-12 mb-4 text-2xl font-bold">
                {t("connectingTitle")}
              </h2>
              <p className="text-[var(--color-muted)]">
                {t.rich("connectingIntro", rich)}
              </p>
              <ul className="mt-4 space-y-3">
                {SESSION_STATUSES.map((name) => (
                  <li key={name} className="flex items-start gap-3">
                    <span className="pill shrink-0">{name}</span>
                    <span className="text-sm text-[var(--color-muted)]">
                      {t(`statuses.${name}`)}
                    </span>
                  </li>
                ))}
              </ul>

              <h3 className="mt-8 text-lg font-semibold">{t("embedTitle")}</h3>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                {t.rich("embedDesc", rich)}
              </p>
              <pre className="mt-3">
                <code className="block bg-[var(--color-surface-2)] rounded-lg p-4 overflow-x-auto text-xs font-mono">
                  {embedQrExample}
                </code>
              </pre>
            </section>

            {/* Webhooks */}
            <section id="webhooks">
              <h2 className="mt-12 mb-4 text-2xl font-bold">
                {t("webhooksTitle")}
              </h2>
              <p className="text-[var(--color-muted)]">{t("webhooksIntro")}</p>

              <h3 className="mt-8 text-lg font-semibold">{t("eventsTitle")}</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                      <th className="py-2 pr-4 font-medium">{t("eventCol")}</th>
                      <th className="py-2 font-medium">
                        {t("descriptionCol")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {EVENTS.map((e) => (
                      <tr
                        key={e.name}
                        className="border-b border-[var(--color-border)]"
                      >
                        <td className="py-2 pr-4 align-top">
                          <code className="pill">{e.name}</code>
                        </td>
                        <td className="py-2 text-[var(--color-muted)]">
                          {t(`events.${e.key}`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="mt-8 text-lg font-semibold">
                {t("headersTitle")}
              </h3>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                {t("headersIntro")}
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                      <th className="py-2 pr-4 font-medium">
                        {t("headerCol")}
                      </th>
                      <th className="py-2 font-medium">
                        {t("descriptionCol")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {HEADERS.map((h) => (
                      <tr
                        key={h.name}
                        className="border-b border-[var(--color-border)]"
                      >
                        <td className="py-2 pr-4 align-top">
                          <code className="pill">{h.name}</code>
                        </td>
                        <td className="py-2 text-[var(--color-muted)]">
                          {t(`headers.${h.key}`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="mt-8 text-lg font-semibold">
                {t("envelopeTitle")}
              </h3>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                {t.rich("envelopeDesc", rich)}
              </p>
              <pre className="mt-3">
                <code className="block bg-[var(--color-surface-2)] rounded-lg p-4 overflow-x-auto text-xs font-mono">
                  {payloadExample}
                </code>
              </pre>

              <h3 className="mt-8 text-lg font-semibold">
                {t("customizeTitle")}
              </h3>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                {t.rich("customizeDesc", rich)}
              </p>
              <pre className="mt-3">
                <code className="block bg-[var(--color-surface-2)] rounded-lg p-4 overflow-x-auto text-xs font-mono">
                  {mappingExample}
                </code>
              </pre>

              <h3 className="mt-8 text-lg font-semibold">
                {t("signatureTitle")}
              </h3>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                {t.rich("signatureDesc", rich)}
              </p>
              <pre className="mt-3">
                <code className="block bg-[var(--color-surface-2)] rounded-lg p-4 overflow-x-auto text-xs font-mono">
                  {verifyExample}
                </code>
              </pre>
            </section>

            {/* Sending messages */}
            <section id="sending">
              <h2 className="mt-12 mb-4 text-2xl font-bold">
                {t("sendingTitle")}
              </h2>
              <p className="text-[var(--color-muted)]">
                {t.rich("sendingIntro", rich)}
              </p>
              <p className="mt-4 text-sm text-[var(--color-muted)]">
                {t.rich("sendingTo", rich)}
              </p>
              <pre className="mt-4">
                <code className="block bg-[var(--color-surface-2)] rounded-lg p-4 overflow-x-auto text-xs font-mono">
                  {sendCurl}
                </code>
              </pre>
              <p className="mt-4 text-sm text-[var(--color-muted)]">
                {t("sendingSuccess")}
              </p>
              <pre className="mt-3">
                <code className="block bg-[var(--color-surface-2)] rounded-lg p-4 overflow-x-auto text-xs font-mono">
                  {sendResponse}
                </code>
              </pre>
            </section>

            {/* API reference */}
            <section id="api-reference">
              <h2 className="mt-12 mb-4 text-2xl font-bold">
                {t("apiRefTitle")}
              </h2>
              <p className="text-[var(--color-muted)]">
                {t.rich("apiRefIntro", rich)}
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                      <th className="py-2 pr-4 font-medium">
                        {t("methodCol")}
                      </th>
                      <th className="py-2 pr-4 font-medium">{t("pathCol")}</th>
                      <th className="py-2 font-medium">{t("authCol")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endpoints.map((e) => (
                      <tr
                        key={`${e.method} ${e.path}`}
                        className="border-b border-[var(--color-border)]"
                      >
                        <td className="py-2 pr-4 align-top">
                          <span className="badge bg-[var(--color-surface-2)] text-[var(--color-brand)]">
                            {e.method}
                          </span>
                        </td>
                        <td className="py-2 pr-4 align-top font-mono text-xs text-[var(--color-fg)]">
                          {e.path}
                        </td>
                        <td className="py-2 align-top text-[var(--color-muted)]">
                          {t(`auth.${e.auth}`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Errors & limits */}
            <section id="errors">
              <h2 className="mt-12 mb-4 text-2xl font-bold">
                {t("errorsTitle")}
              </h2>
              <ul className="mt-2 space-y-3 text-sm text-[var(--color-muted)]">
                <li className="flex items-start gap-3">
                  <span className="badge shrink-0 bg-[var(--color-surface-2)] text-[var(--color-accent)]">
                    401
                  </span>
                  <span>{t("err401")}</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="badge shrink-0 bg-[var(--color-surface-2)] text-[var(--color-accent)]">
                    400
                  </span>
                  <span>{t.rich("err400", rich)}</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="badge shrink-0 bg-[var(--color-surface-2)] text-[var(--color-accent)]">
                    {t("errWebhooksLabel")}
                  </span>
                  <span>{t("errWebhooks")}</span>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
