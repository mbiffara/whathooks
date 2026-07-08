import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import Link from "next/link";

const nav = [
  { id: "introduction", label: "Introduction" },
  { id: "quickstart", label: "Quickstart" },
  { id: "connecting", label: "Connecting a number" },
  { id: "webhooks", label: "Webhooks" },
  { id: "sending", label: "Sending messages" },
  { id: "api-reference", label: "API reference" },
  { id: "errors", label: "Errors & limits" },
];

const sessionStatuses = [
  { name: "PENDING", meaning: "Session created, not yet initialized." },
  { name: "QR", meaning: "A QR code is ready to be scanned with WhatsApp." },
  { name: "CONNECTING", meaning: "Pairing accepted, establishing the connection." },
  { name: "CONNECTED", meaning: "Online and ready to send and receive messages." },
  { name: "DISCONNECTED", meaning: "Connection dropped; reconnection is attempted automatically." },
  { name: "LOGGED_OUT", meaning: "The device was unlinked; a new QR scan is required." },
];

const events = [
  { name: "message.received", desc: "An inbound WhatsApp message arrived on a connected session." },
  { name: "session.status", desc: "A session changed status (e.g. CONNECTED, DISCONNECTED, LOGGED_OUT)." },
  { name: "session.qr", desc: "A new QR code was generated and is waiting to be scanned." },
];

const headers = [
  { name: "X-Whathooks-Event", desc: "The event type, e.g. message.received." },
  { name: "X-Whathooks-Signature", desc: "HMAC-SHA256 of the raw body, formatted as sha256=<hex>." },
  { name: "X-Whathooks-Delivery", desc: "A unique ID for this delivery attempt." },
];

const endpoints = [
  { method: "POST", path: "/v1/auth/register", auth: "Public" },
  { method: "POST", path: "/v1/auth/login", auth: "Public" },
  { method: "GET", path: "/v1/sessions", auth: "JWT / API key" },
  { method: "POST", path: "/v1/sessions", auth: "JWT / API key" },
  { method: "GET", path: "/v1/sessions/:id", auth: "JWT / API key" },
  { method: "POST", path: "/v1/sessions/:id/logout", auth: "JWT / API key" },
  { method: "GET", path: "/v1/webhooks", auth: "JWT / API key" },
  { method: "POST", path: "/v1/webhooks", auth: "JWT / API key" },
  { method: "POST", path: "/v1/messages", auth: "API key" },
  { method: "GET", path: "/v1/messages", auth: "JWT / API key" },
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
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
          <aside className="hidden lg:block">
            <nav className="lg:sticky lg:top-20 space-y-1 text-sm">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                Documentation
              </p>
              {nav.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="block rounded-md px-3 py-2 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </aside>

          <div className="max-w-3xl">
            <div className="mb-8">
              <span className="badge bg-[var(--color-surface-2)] text-[var(--color-accent)]">
                API reference
              </span>
              <h1 className="mt-4 text-4xl font-bold tracking-tight">
                whathooks documentation
              </h1>
              <p className="mt-3 text-[var(--color-muted)]">
                Connect a WhatsApp number, receive inbound messages on your
                webhook, and send replies through our REST API.
              </p>
            </div>

            {/* Introduction */}
            <section id="introduction">
              <h2 className="mt-12 mb-4 text-2xl font-bold">Introduction</h2>
              <p className="text-[var(--color-muted)]">
                whathooks lets your clients connect their own WhatsApp number by
                scanning a QR code. Once linked, the integration works in two
                directions:
              </p>
              <ul className="mt-4 space-y-2 text-[var(--color-muted)]">
                <li>
                  <span className="text-[var(--color-fg)] font-medium">
                    Inbound &rarr; webhook.
                  </span>{" "}
                  Every message your number receives is POSTed as JSON to a
                  webhook URL you configure.
                </li>
                <li>
                  <span className="text-[var(--color-fg)] font-medium">
                    Outbound &rarr; API.
                  </span>{" "}
                  You send replies by calling our REST API at{" "}
                  <code className="pill">/v1</code>.
                </li>
              </ul>
              <p className="mt-4 text-[var(--color-muted)]">
                Your number is connected through a WhatsApp Web link, the same
                mechanism as WhatsApp&apos;s &ldquo;linked devices&rdquo;.
                Reconnection after a dropped link is handled automatically, and
                each number supports one linked device.
              </p>
              <div className="card mt-6 border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-muted)]">
                Because this uses an unofficial WhatsApp Web connection, treat it
                like a linked device: keep the phone reachable and avoid behavior
                that could get the number flagged by WhatsApp.
              </div>
            </section>

            {/* Quickstart */}
            <section id="quickstart">
              <h2 className="mt-12 mb-4 text-2xl font-bold">Quickstart</h2>
              <p className="text-[var(--color-muted)]">
                Get from zero to a sent message in four steps.
              </p>
              <ol className="mt-4 space-y-4">
                <li className="card">
                  <h3 className="text-lg font-semibold">
                    1. Create an account &amp; organization
                  </h3>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    Sign up and create an organization. All sessions, webhooks,
                    and API keys live under your organization.
                  </p>
                </li>
                <li className="card">
                  <h3 className="text-lg font-semibold">
                    2. Create a WhatsApp session &amp; scan the QR
                  </h3>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    Create a session in the dashboard, then open WhatsApp on your
                    phone &rarr; <span className="pill">Linked Devices</span>{" "}
                    &rarr; <span className="pill">Link a Device</span> and scan
                    the QR.
                  </p>
                </li>
                <li className="card">
                  <h3 className="text-lg font-semibold">3. Add a webhook URL</h3>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    Register an HTTPS endpoint to receive{" "}
                    <code className="pill">message.received</code> and session
                    events.
                  </p>
                </li>
                <li className="card">
                  <h3 className="text-lg font-semibold">4. Create an API key</h3>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    Generate an API key to send messages programmatically via{" "}
                    <code className="pill">POST /v1/messages</code>.
                  </p>
                </li>
              </ol>
              <div className="mt-6">
                <Link href="/signup" className="btn-primary">
                  Create your account
                </Link>
              </div>
            </section>

            {/* Connecting a number */}
            <section id="connecting">
              <h2 className="mt-12 mb-4 text-2xl font-bold">
                Connecting a number
              </h2>
              <p className="text-[var(--color-muted)]">
                A session moves through a series of statuses as it links and
                stays online. You can poll a session or subscribe to{" "}
                <code className="pill">session.status</code> webhooks to track
                it.
              </p>
              <ul className="mt-4 space-y-3">
                {sessionStatuses.map((s) => (
                  <li key={s.name} className="flex items-start gap-3">
                    <span className="pill shrink-0">{s.name}</span>
                    <span className="text-sm text-[var(--color-muted)]">
                      {s.meaning}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Webhooks */}
            <section id="webhooks">
              <h2 className="mt-12 mb-4 text-2xl font-bold">Webhooks</h2>
              <p className="text-[var(--color-muted)]">
                When something happens on a session, we POST a JSON body to your
                configured webhook URL.
              </p>

              <h3 className="mt-8 text-lg font-semibold">Events</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                      <th className="py-2 pr-4 font-medium">Event</th>
                      <th className="py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr
                        key={e.name}
                        className="border-b border-[var(--color-border)]"
                      >
                        <td className="py-2 pr-4 align-top">
                          <code className="pill">{e.name}</code>
                        </td>
                        <td className="py-2 text-[var(--color-muted)]">
                          {e.desc}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="mt-8 text-lg font-semibold">Delivery headers</h3>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                Every delivery includes these request headers:
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                      <th className="py-2 pr-4 font-medium">Header</th>
                      <th className="py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headers.map((h) => (
                      <tr
                        key={h.name}
                        className="border-b border-[var(--color-border)]"
                      >
                        <td className="py-2 pr-4 align-top">
                          <code className="pill">{h.name}</code>
                        </td>
                        <td className="py-2 text-[var(--color-muted)]">
                          {h.desc}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="mt-8 text-lg font-semibold">Payload envelope</h3>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                Every delivery body shares the same envelope:{" "}
                <code className="pill">
                  {`{ event, sessionId, data, timestamp }`}
                </code>
                . Below is a full <code className="pill">message.received</code>{" "}
                delivery:
              </p>
              <pre className="mt-3">
                <code className="block bg-[var(--color-surface-2)] rounded-lg p-4 overflow-x-auto text-xs font-mono">
                  {payloadExample}
                </code>
              </pre>

              <h3 className="mt-8 text-lg font-semibold">
                Signature verification
              </h3>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                Verify each delivery by computing an HMAC-SHA256 of the{" "}
                <span className="font-medium text-[var(--color-fg)]">raw</span>{" "}
                request body using your webhook secret, then comparing it to the{" "}
                <code className="pill">X-Whathooks-Signature</code> header. Always
                compare with a constant-time function.
              </p>
              <pre className="mt-3">
                <code className="block bg-[var(--color-surface-2)] rounded-lg p-4 overflow-x-auto text-xs font-mono">
                  {verifyExample}
                </code>
              </pre>
            </section>

            {/* Sending messages */}
            <section id="sending">
              <h2 className="mt-12 mb-4 text-2xl font-bold">Sending messages</h2>
              <p className="text-[var(--color-muted)]">
                Send a message with{" "}
                <code className="pill">POST /v1/messages</code>, authenticated
                with an API key via the{" "}
                <code className="pill">X-API-Key: &lt;token&gt;</code> header.{" "}
                An{" "}
                <code className="pill">Authorization: Bearer &lt;token&gt;</code>{" "}
                header also works.
              </p>
              <p className="mt-4 text-sm text-[var(--color-muted)]">
                The <code className="pill">to</code> field accepts a bare phone
                number (digits only, with country code, no{" "}
                <code className="pill">+</code>) or a full WhatsApp JID. The
                target session must be{" "}
                <code className="pill">CONNECTED</code> or the request returns{" "}
                <code className="pill">400</code>.
              </p>
              <pre className="mt-4">
                <code className="block bg-[var(--color-surface-2)] rounded-lg p-4 overflow-x-auto text-xs font-mono">
                  {sendCurl}
                </code>
              </pre>
              <p className="mt-4 text-sm text-[var(--color-muted)]">
                A successful request responds with the queued message:
              </p>
              <pre className="mt-3">
                <code className="block bg-[var(--color-surface-2)] rounded-lg p-4 overflow-x-auto text-xs font-mono">
                  {sendResponse}
                </code>
              </pre>
            </section>

            {/* API reference */}
            <section id="api-reference">
              <h2 className="mt-12 mb-4 text-2xl font-bold">API reference</h2>
              <p className="text-[var(--color-muted)]">
                Base URL in production:{" "}
                <code className="pill">https://api.whathooks.com/v1</code>.
                Dashboard requests use a{" "}
                <span className="font-medium text-[var(--color-fg)]">JWT</span>{" "}
                (from <code className="pill">/v1/auth/login</code>), while
                programmatic requests use an{" "}
                <span className="font-medium text-[var(--color-fg)]">
                  API key
                </span>
                .
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                      <th className="py-2 pr-4 font-medium">Method</th>
                      <th className="py-2 pr-4 font-medium">Path</th>
                      <th className="py-2 font-medium">Auth</th>
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
                          {e.auth}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Errors & limits */}
            <section id="errors">
              <h2 className="mt-12 mb-4 text-2xl font-bold">Errors &amp; limits</h2>
              <ul className="mt-2 space-y-3 text-sm text-[var(--color-muted)]">
                <li className="flex items-start gap-3">
                  <span className="badge shrink-0 bg-[var(--color-surface-2)] text-[var(--color-accent)]">
                    401
                  </span>
                  <span>Missing or invalid credentials (JWT or API key).</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="badge shrink-0 bg-[var(--color-surface-2)] text-[var(--color-accent)]">
                    400
                  </span>
                  <span>
                    The session is not{" "}
                    <code className="pill">CONNECTED</code>, or the request body
                    is invalid.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="badge shrink-0 bg-[var(--color-surface-2)] text-[var(--color-accent)]">
                    Webhooks
                  </span>
                  <span>
                    Delivery requests time out after 10 seconds. For now we make
                    a single delivery attempt per event &mdash; automatic retries
                    are coming.
                  </span>
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
