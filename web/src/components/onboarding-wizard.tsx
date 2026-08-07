"use client";

import { Glyph } from "@/components/glyphs";
import { StatusBadge } from "@/components/status-badge";
import { apiClient, isSubscriptionRequired } from "@/lib/client-api";
import type {
  Agent,
  Subscription,
  WaSession,
  WaSessionDetail,
} from "@/lib/types";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

/** What the org came here to do. Only this is stored; the rest is derived. */
type Purpose = "automate" | "humans" | "api";

const PURPOSES: {
  key: Purpose;
  title: string;
  blurb: string;
}[] = [
  {
    key: "automate",
    title: "Answer automatically",
    blurb:
      "An AI agent replies to your customers around the clock, and hands over to a person when it should.",
  },
  {
    key: "humans",
    title: "Hand off to my team",
    blurb:
      "Your team answers from their own WhatsApp through private groups. Customers only ever see your business number.",
  },
  {
    key: "api",
    title: "Connect it to my product",
    blurb:
      "Send and receive messages from your own system over the REST API and webhooks.",
  },
];

const PURPOSE_KEY = "ONBOARDING_PURPOSE";

export function OnboardingWizard() {
  const { data: auth } = useSession();
  const token = auth?.accessToken;

  const [purpose, setPurpose] = useState<Purpose | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(PURPOSE_KEY);
    return stored === "automate" || stored === "humans" || stored === "api"
      ? stored
      : null;
  });
  const [sub, setSub] = useState<Subscription | null>(null);
  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Session being connected in step 3, polled for its QR.
  const [pending, setPending] = useState<WaSessionDetail | null>(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Progress is read from live state, never from stored flags, so deleting a
   * session or an agent walks the wizard back instead of leaving it lying.
   */
  const load = useCallback(async () => {
    if (!token) return;
    const [s, ss, ag] = await Promise.all([
      apiClient<Subscription>("/billing/subscription", token).catch(() => null),
      apiClient<WaSession[]>("/sessions", token).catch(() => []),
      apiClient<Agent[]>("/agents", token).catch(() => []),
    ]);
    setSub(s);
    setSessions(ss);
    setAgents(ag);
    setLoaded(true);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll the pending session until WhatsApp reports it connected.
  useEffect(() => {
    if (!token || !pending || pending.status === "CONNECTED") return;
    let active = true;
    const tick = async () => {
      const fresh = await apiClient<WaSessionDetail>(
        `/sessions/${pending.id}`,
        token,
      ).catch(() => null);
      if (!active) return;
      if (fresh) {
        setPending(fresh);
        if (fresh.status === "CONNECTED") {
          void load();
          return;
        }
      }
      timer.current = setTimeout(tick, 2500);
    };
    timer.current = setTimeout(tick, 2500);
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [token, pending, load]);

  function choose(p: Purpose) {
    localStorage.setItem(PURPOSE_KEY, p);
    setPurpose(p);
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !label.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await apiClient<WaSession>("/sessions", token, {
        method: "POST",
        body: JSON.stringify({ label: label.trim() }),
      });
      setPending({ ...created, qr: null, qrDataUrl: null });
    } catch (err) {
      setError(
        isSubscriptionRequired(err)
          ? "Start your trial first."
          : err instanceof Error
            ? err.message
            : "Something went wrong.",
      );
    } finally {
      setCreating(false);
    }
  }

  const subscribed = Boolean(sub?.subscribed);
  const connected = sessions.find((s) => s.status === "CONNECTED") ?? null;
  const hasAgent = agents.length > 0;

  const steps = [
    {
      key: "purpose",
      title: "What do you want to do?",
      done: purpose !== null,
    },
    { key: "trial", title: "Start your free trial", done: subscribed },
    {
      key: "connect",
      title: "Connect your WhatsApp number",
      done: !!connected,
    },
    { key: "win", title: firstWinTitle(purpose), done: firstWinDone() },
  ];
  // The first unfinished step is the open one; earlier ones collapse to a tick.
  const currentIndex = steps.findIndex((s) => !s.done);
  const current = currentIndex === -1 ? steps.length : currentIndex;

  function firstWinDone(): boolean {
    if (!connected) return false;
    if (purpose === "automate") return hasAgent;
    return false; // the human-team and API paths are checked off by hand for now
  }

  if (!loaded) {
    return <p className="text-sm text-[var(--color-muted)]">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {steps.map((step, i) => {
        const open = i === current;
        return (
          <div
            key={step.key}
            className={`card ${open ? "" : "opacity-70"} ${
              step.done ? "border-[var(--color-brand)]/40" : ""
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                  step.done
                    ? "bg-[var(--color-brand)] text-[var(--color-on-brand)]"
                    : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
                }`}
              >
                {step.done ? <Glyph name="check" size={14} /> : i + 1}
              </span>
              <h2 className="font-semibold">{step.title}</h2>
            </div>

            {open && step.key === "purpose" && (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {PURPOSES.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => choose(p.key)}
                    className="rounded-xl border border-[var(--color-border)] p-4 text-left transition-colors hover:border-[var(--color-brand)]"
                  >
                    <div className="font-medium">{p.title}</div>
                    <div className="mt-1 text-xs text-[var(--color-muted)]">
                      {p.blurb}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {open && step.key === "trial" && (
              <div className="mt-3">
                <p className="text-sm text-[var(--color-muted)]">
                  Connecting a number needs an active subscription. New ones
                  start with a 7-day free trial and you can cancel any time.
                </p>
                <Link href="/dashboard/billing" className="btn-primary mt-4">
                  Start free trial
                </Link>
              </div>
            )}

            {open && step.key === "connect" && (
              <div className="mt-3">
                {!pending ? (
                  <form onSubmit={connect} className="flex flex-col gap-3">
                    <p className="text-sm text-[var(--color-muted)]">
                      Name the connection, then scan the QR from the phone that
                      owns the number. The phone keeps working as usual.
                    </p>
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="label" htmlFor="ob-label">
                          Connection name
                        </label>
                        <input
                          id="ob-label"
                          className="input w-64"
                          placeholder="e.g. Sales line"
                          maxLength={60}
                          value={label}
                          onChange={(e) => setLabel(e.target.value)}
                        />
                      </div>
                      <button
                        type="submit"
                        className="btn-primary"
                        disabled={creating || !label.trim()}
                      >
                        {creating ? "Creating…" : "Create & show QR"}
                      </button>
                    </div>
                  </form>
                ) : pending.qrDataUrl ? (
                  <div className="flex flex-wrap items-center gap-6">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={pending.qrDataUrl}
                      alt="WhatsApp QR code"
                      className="h-52 w-52 rounded-xl border border-[var(--color-border)] bg-white p-2"
                    />
                    <ol className="flex flex-col gap-1 text-sm text-[var(--color-muted)]">
                      <li>1. Open WhatsApp on the phone</li>
                      <li>2. Settings → Linked devices</li>
                      <li>3. Link a device, then scan this code</li>
                    </ol>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-muted)]">
                    Waiting for the QR code…{" "}
                    <StatusBadge status={pending.status} />
                  </p>
                )}
                {error && (
                  <p className="mt-3 text-sm text-[var(--color-danger)]">
                    {error}
                  </p>
                )}
              </div>
            )}

            {open && step.key === "win" && (
              <FirstWin purpose={purpose} sessionLabel={connected?.label} />
            )}

            {!open && step.done && step.key === "connect" && connected && (
              <p className="mt-2 text-xs text-[var(--color-muted)]">
                {connected.label}
                {connected.phoneNumber ? ` · +${connected.phoneNumber}` : ""}
              </p>
            )}
          </div>
        );
      })}

      {current === steps.length && (
        <div className="card border-[var(--color-brand)]/40">
          <p className="text-sm">
            You&apos;re set up. Everything else lives in the dashboard.
          </p>
        </div>
      )}
    </div>
  );
}

function firstWinTitle(purpose: Purpose | null): string {
  switch (purpose) {
    case "humans":
      return "Add your first human agent";
    case "api":
      return "Make your first API call";
    default:
      return "Create your AI agent";
  }
}

/** The branch: each purpose gets the shortest path to something working. */
function FirstWin({
  purpose,
  sessionLabel,
}: {
  purpose: Purpose | null;
  sessionLabel?: string;
}) {
  if (purpose === "humans") {
    return (
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-sm text-[var(--color-muted)]">
          Add the people who will answer, with the WhatsApp number each one
          uses. When a conversation is handed to them, whathooks opens a private
          group with that person; the customer only ever sees{" "}
          {sessionLabel ?? "your business number"}.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard/human-agents" className="btn-primary">
            Add a human agent
          </Link>
          <Link href="/dashboard/mirror" className="btn-ghost">
            Set up the handoff
          </Link>
        </div>
      </div>
    );
  }

  if (purpose === "api") {
    return (
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-sm text-[var(--color-muted)]">
          Create an API key, then send a message from your own system. Add a
          webhook to receive replies.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-[var(--color-surface-2)] p-3 text-xs">
          {`curl -X POST https://api.whathooks.app/v1/messages \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"5491155551234","text":"Hello from whathooks"}'`}
        </pre>
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard/api-keys" className="btn-primary">
            Create an API key
          </Link>
          <Link href="/dashboard/webhooks" className="btn-ghost">
            Add a webhook
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <p className="text-sm text-[var(--color-muted)]">
        Agents run on your own Anthropic or OpenAI account, so whathooks never
        marks up model usage. You&apos;ll need an API key from one of them
        before this step works.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/dashboard/agents" className="btn-primary">
          Create an AI agent
        </Link>
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost"
        >
          Get an Anthropic key
        </a>
      </div>
    </div>
  );
}
