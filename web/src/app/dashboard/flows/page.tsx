"use client";

import { StatusBadge } from "@/components/status-badge";
import { apiClient } from "@/lib/client-api";
import type { WaSession, WaStatus } from "@/lib/types";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const TEMPLATES = [
  {
    key: "blank",
    title: "Blank",
    desc: "Just the trigger — build from scratch.",
  },
  {
    key: "ai-until-handoff",
    title: "AI until handoff",
    desc: "An AI agent answers everything; when it hands off, the lead goes to a human agent (Mirror group).",
  },
  {
    key: "intent-routing",
    title: "Intent routing",
    desc: "Classify each conversation; buyers go to a human agent, the rest get AI answers.",
  },
  {
    key: "round-robin",
    title: "Round-robin dispatch",
    desc: "Every new lead is assigned to your human agents, in turns.",
  },
  {
    key: "faq-keyword",
    title: "FAQ keywords",
    desc: "Messages with your keywords get an AI answer; everything else goes to a human agent.",
  },
] as const;

interface FlowRow {
  id: string;
  name: string;
  enabled: boolean;
  nodes: number;
  session: {
    id: string;
    label: string;
    phoneNumber: string | null;
    status: WaStatus;
  };
  updatedAt: string;
}

/** Flows list — platform-admin experiment (English-only). */
export default function FlowsPage() {
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<string>("blank");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [flowList, sessionList] = await Promise.all([
        apiClient<FlowRow[]>("/flows", token),
        apiClient<WaSession[]>("/sessions", token),
      ]);
      setFlows(flowList);
      setSessions(sessionList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const flow = await apiClient<{ id: string }>("/flows", token, {
        method: "POST",
        body: JSON.stringify({ sessionId, name: name.trim(), template }),
      });
      window.location.href = `/dashboard/flows/${flow.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
      setBusy(false);
    }
  }

  const availableSessions = sessions.filter(
    (s) => !flows.some((f) => f.session.id === s.id),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">
          Flows{" "}
          <span className="badge bg-[var(--color-warning-bg)] text-[var(--color-warning)] align-middle text-xs">
            experimental
          </span>
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Visual routing for a session&apos;s inbound messages: AI replies,
          intent branches, keyword FAQs, human-agent handoffs (Mirror), tags
          and webhooks. An enabled flow takes over the session&apos;s
          automation.
        </p>
      </div>

      <form onSubmit={create} className="card flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <label className="label">Session</label>
          <select
            className="input"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            required
          >
            <option value="">Select a session…</option>
            {availableSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.phoneNumber ? ` (+${s.phoneNumber})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-52 flex-1">
          <label className="label">Name</label>
          <input
            className="input"
            placeholder="Lead routing"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
        </div>
        <div className="w-full">
          <label className="label">Start from</label>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {TEMPLATES.map((tp) => (
              <button
                type="button"
                key={tp.key}
                onClick={() => setTemplate(tp.key)}
                className={`rounded-xl border p-3 text-left ${
                  template === tp.key
                    ? "border-[var(--color-brand)] bg-[var(--color-brand)]/5"
                    : "border-[var(--color-border)] hover:border-[var(--color-brand)]/40"
                }`}
              >
                <div className="text-sm font-medium">{tp.title}</div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  {tp.desc}
                </div>
              </button>
            ))}
          </div>
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          Create flow
        </button>
      </form>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      ) : flows.length === 0 ? (
        <div className="card text-sm text-[var(--color-muted)]">
          No flows yet. Create one to start routing conversations.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {flows.map((f) => (
            <Link
              key={f.id}
              href={`/dashboard/flows/${f.id}`}
              className="card flex items-center gap-4 hover:border-[var(--color-brand)]/40"
            >
              <div className="min-w-0">
                <div className="font-medium">{f.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  {f.session.label}
                  {f.session.phoneNumber && ` (+${f.session.phoneNumber})`}
                  <StatusBadge status={f.session.status} />
                </div>
              </div>
              <span className="ml-auto text-xs text-[var(--color-muted)]">
                {f.nodes} node{f.nodes === 1 ? "" : "s"}
              </span>
              <span
                className={`badge ${
                  f.enabled
                    ? "bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
                    : "bg-[var(--color-chip)] text-[var(--color-muted)]"
                }`}
              >
                {f.enabled ? "enabled" : "disabled"}
              </span>
              <span className="text-[var(--color-brand)]">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
