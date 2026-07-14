import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import Link from "next/link";

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

const steps = [
  {
    title: "Scan a QR to link your number",
    desc: "Open the dashboard, scan the QR with WhatsApp on your phone, and your number is live in seconds. No Business API paperwork.",
  },
  {
    title: "Receive every message on your webhook",
    desc: "Each inbound message is delivered to your endpoint as a signed JSON event the moment it arrives.",
  },
  {
    title: "Reply with a simple POST to our API",
    desc: "Send a text back through one REST call. We handle the WhatsApp connection, retries, and delivery state for you.",
  },
];

const features = [
  {
    icon: "📷",
    title: "QR pairing in seconds",
    desc: "Link a real WhatsApp number by scanning a QR — no app review, no approval queue.",
  },
  {
    icon: "🔐",
    title: "Signed webhooks (HMAC-SHA256)",
    desc: "Every delivery is signed so you can verify it genuinely came from whathooks.",
  },
  {
    icon: "✉️",
    title: "Send text via REST API",
    desc: "Reply to any conversation with a single authenticated POST request.",
  },
  {
    icon: "📱",
    title: "Multiple numbers per account",
    desc: "Run many sessions side by side, each with its own webhook and API key.",
  },
  {
    icon: "🔁",
    title: "Delivery logs & retries",
    desc: "Inspect every event, see response codes, and let failed deliveries retry automatically.",
  },
  {
    icon: "⚡",
    title: "Self-serve dashboard",
    desc: "Connect numbers, rotate keys, and watch live traffic without filing a ticket.",
  },
];

const plans = [
  {
    name: "Starter",
    price: "$9.99",
    period: "per month",
    desc: "Get started with your own number.",
    cta: "Start with Starter",
    highlighted: false,
    items: [
      "1 WhatsApp number",
      "5,000 messages / month",
      "1 webhook endpoint",
      "30-day message history",
      "Community support",
    ],
  },
  {
    name: "Pro",
    price: "$29.99",
    period: "per month",
    desc: "For products with real conversation volume.",
    cta: "Start with Pro",
    highlighted: true,
    items: [
      "3 WhatsApp numbers",
      "10,000 messages / month",
      "Unlimited webhooks",
      "AI agents (bring your own key)",
      "Team members & roles",
      "90-day message history",
      "Email support",
    ],
  },
  {
    name: "Business",
    price: "$99",
    period: "per month",
    desc: "Scale across numbers, teams, and workflows.",
    cta: "Start with Business",
    highlighted: false,
    items: [
      "10 WhatsApp numbers",
      "100,000 messages / month",
      "Unlimited webhooks & agents",
      "Unlimited team members",
      "Full message history",
      "Priority support",
    ],
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="grid items-center gap-14 md:grid-cols-2">
            <div>
              <span className="badge border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)]" />
                Your own number · No Business API approval
              </span>
              <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
                WhatsApp as a{" "}
                <span className="text-[var(--color-brand)]">webhook</span>.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-muted)]">
                Connect your own WhatsApp number with a QR scan. Every message
                you receive is POSTed to your endpoint, and you reply with a
                single REST call. No Business API, no waiting.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/signup" className="btn-primary">
                  Connect your WhatsApp
                </Link>
                <Link href="/docs" className="btn-ghost">
                  Read the docs
                </Link>
              </div>
              <p className="mt-5 text-sm text-[var(--color-muted)]">
                Set up in minutes · Cancel anytime
              </p>
            </div>

            {/* Flow visual */}
            <div className="card border-[var(--color-border)] bg-[var(--color-surface)]/80 p-6 md:p-7">
              <p className="mb-5 text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
                The flow
              </p>
              <div className="flex flex-col gap-3">
                {/* QR */}
                <div className="flex items-center gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[var(--color-bg)]">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="text-[var(--color-brand)]"
                    >
                      <path
                        d="M4 4h6v6H4V4zm0 10h6v6H4v-6zM14 4h6v6h-6V4zm0 12h2v2h-2v-2zm4 0h2v2h-2v-2zm-4 2v2h2v-2h-2zm4 0v2h2v-2h-2z"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Scan the QR</p>
                    <p className="text-xs text-[var(--color-muted)]">
                      Link your number with WhatsApp
                    </p>
                  </div>
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

                {/* Inbound */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Inbound message</p>
                    <span className="pill">message.received</span>
                  </div>
                  <p className="mt-2 rounded-md bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-fg)]">
                    “Hi! Is my order shipped yet?”
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

                {/* Webhook + reply */}
                <div className="flex items-center gap-4 rounded-xl border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/5 p-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[var(--color-bg)]">
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="text-[var(--color-brand)]"
                    >
                      <path
                        d="M4 7l8 6 8-6M4 7v10h16V7M4 7l8 6 8-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">
                      Your webhook → reply via API
                    </p>
                    <p className="text-xs text-[var(--color-muted)]">
                      POST /v1/messages to respond
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Dashboard inbox + teams */}
        <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Not just an API
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">
              Everything also works from the dashboard — chat with your
              customers and bring your whole team along.
            </p>
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            {/* Team inbox */}
            <div className="card transition-colors hover:border-[var(--color-brand)]/40">
              <h3 className="text-lg font-semibold">A built-in inbox</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
                Send and receive messages right from the dashboard — full
                conversation history, media, and replies in real time. No code
                required to talk to your customers.
              </p>
              <div className="mt-6 flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                <div className="max-w-[80%] self-start rounded-lg rounded-bl-none bg-[var(--color-bg)] px-3 py-2 text-xs">
                  Hi! Is my order shipped yet?
                </div>
                <div className="max-w-[80%] self-end rounded-lg rounded-br-none bg-[var(--color-brand)]/15 px-3 py-2 text-xs">
                  Yes — it shipped this morning! 🎉
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
                  <span className="flex-1 text-xs text-[var(--color-muted)]">
                    Type a reply…
                  </span>
                  <span className="rounded-md bg-[var(--color-brand)] px-2 py-1 text-[10px] font-semibold text-black">
                    Send
                  </span>
                </div>
              </div>
            </div>

            {/* Teams */}
            <div className="card transition-colors hover:border-[var(--color-brand)]/40">
              <h3 className="text-lg font-semibold">Built for teams</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
                Invite your whole team into one organization with roles — owners
                handle billing, admins manage numbers and webhooks, members work
                the inbox. Everyone shares the same numbers and history.
              </p>
              <div className="mt-6 flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                {[
                  { name: "Ana Pereira", role: "Owner" },
                  { name: "Luis Gómez", role: "Admin" },
                  { name: "Sam Chen", role: "Member" },
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
              How it works
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">
              From a fresh account to a two-way WhatsApp integration in three
              steps.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {steps.map((step, i) => (
              <div key={step.title} className="card">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--color-brand)] text-base font-bold text-black">
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
              Everything you need to ship
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">
              The plumbing for real WhatsApp conversations — handled.
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
              A clean, predictable API
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">
              Receive structured events, reply with a single request.
            </p>
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <div className="card">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Inbound webhook</h3>
                <span className="badge bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                  POST · your endpoint
                </span>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-[var(--color-surface-2)] p-4 font-mono text-xs leading-relaxed text-[var(--color-fg)]">
                <code>{inboundPayload}</code>
              </pre>
            </div>
            <div className="card">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Send a reply</h3>
                <span className="badge bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                  POST · /v1/messages
                </span>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-[var(--color-surface-2)] p-4 font-mono text-xs leading-relaxed text-[var(--color-accent)]">
                <code>{replySnippet}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section
          id="pricing"
          className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16 md:py-24"
        >
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Simple pricing
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">
              Start free, upgrade when your volume grows. Cancel anytime.
            </p>
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
                      Most popular
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-sm text-[var(--color-muted)]">
                    {plan.period}
                  </span>
                </div>
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
            Message limits count both inbound and outbound messages. Need more?{" "}
            <a
              href="mailto:hello@logicalminds.co"
              className="text-[var(--color-brand)] hover:underline"
            >
              Talk to us
            </a>
            .
          </p>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-6xl px-6 pb-24 pt-4">
          <div className="card overflow-hidden border-[var(--color-brand)]/30 bg-[var(--color-surface)] px-6 py-14 text-center md:px-12 md:py-16">
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              Turn your WhatsApp number into a webhook today
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[var(--color-muted)]">
              Scan a QR, point us at your endpoint, and start handling
              conversations in code. No Business API approval required.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/signup" className="btn-primary">
                Connect your WhatsApp
              </Link>
              <Link href="/docs" className="btn-ghost">
                Read the docs
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
