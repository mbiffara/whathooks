"use client";

import { apiClient } from "@/lib/client-api";
import type { WaSession, Webhook } from "@/lib/types";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

const EVENTS = ["message.received", "session.status", "session.qr"];

export default function WebhooksPage() {
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["message.received"]);
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [h, s] = await Promise.all([
        apiClient<Webhook[]>("/webhooks", token),
        apiClient<WaSession[]>("/sessions", token),
      ]);
      setHooks(h);
      setSessions(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleEvent(ev: string) {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    );
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setNewSecret(null);
    try {
      const created = await apiClient<Webhook>("/webhooks", token, {
        method: "POST",
        body: JSON.stringify({
          url,
          events,
          sessionId: sessionId || undefined,
        }),
      });
      setNewSecret(created.secret ?? null);
      setUrl("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    }
  }

  async function toggleActive(h: Webhook) {
    if (!token) return;
    await apiClient(`/webhooks/${h.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ active: !h.active }),
    });
    load();
  }

  async function remove(id: string) {
    if (!token) return;
    await apiClient(`/webhooks/${id}`, token, { method: "DELETE" });
    load();
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Webhooks</h1>
        <p className="text-sm text-[var(--color-muted)]">
          We POST events to these URLs, signed with HMAC-SHA256.
        </p>
      </div>

      <form onSubmit={create} className="card flex flex-col gap-4">
        <div>
          <label className="label">Endpoint URL</label>
          <input
            className="input"
            placeholder="https://yourapp.com/webhooks/whathooks"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Events</label>
          <div className="flex flex-wrap gap-2">
            {EVENTS.map((ev) => (
              <button
                type="button"
                key={ev}
                onClick={() => toggleEvent(ev)}
                className={`badge border ${
                  events.includes(ev)
                    ? "border-[var(--color-brand)] bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
                    : "border-[var(--color-border)] text-[var(--color-muted)]"
                }`}
              >
                {ev}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Scope (optional)</label>
          <select
            className="input"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
          >
            <option value="">All sessions</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary self-start" disabled={!events.length}>
          Add webhook
        </button>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {newSecret && (
        <div className="card border-[var(--color-brand)]/40">
          <p className="text-sm font-medium">
            Signing secret — copy it now, it won’t be shown again:
          </p>
          <code className="mt-2 block break-all rounded-lg bg-[var(--color-surface-2)] p-3 font-mono text-sm text-[var(--color-accent)]">
            {newSecret}
          </code>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      ) : hooks.length === 0 ? (
        <div className="card text-sm text-[var(--color-muted)]">No webhooks yet.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {hooks.map((h) => (
            <div key={h.id} className="card flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate font-mono text-sm">{h.url}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {h.events.map((ev) => (
                    <span key={ev} className="pill">{ev}</span>
                  ))}
                </div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  secret {h.secretHint}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => toggleActive(h)} className="btn-ghost">
                  {h.active ? "Disable" : "Enable"}
                </button>
                <button onClick={() => remove(h.id)} className="btn-danger">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
