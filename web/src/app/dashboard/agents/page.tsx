"use client";

import { apiClient } from "@/lib/client-api";
import { AGENT_MODELS, type Agent } from "@/lib/types";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

type Draft = {
  id?: string;
  name: string;
  soul: string;
  instructions: string;
  model: string;
  enabled: boolean;
};

const EMPTY: Draft = {
  name: "",
  soul: "",
  instructions: "",
  model: AGENT_MODELS[0].id,
  enabled: true,
};

export default function AgentsPage() {
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setAgents(await apiClient<Agent[]>("/agents", token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({
        name: draft.name,
        soul: draft.soul,
        instructions: draft.instructions,
        model: draft.model,
        enabled: draft.enabled,
      });
      if (draft.id) {
        await apiClient(`/agents/${draft.id}`, token, {
          method: "PATCH",
          body,
        });
      } else {
        await apiClient("/agents", token, { method: "POST", body });
      }
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!token) return;
    await apiClient(`/agents/${id}`, token, { method: "DELETE" });
    load();
  }

  async function toggle(a: Agent) {
    if (!token) return;
    await apiClient(`/agents/${a.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !a.enabled }),
    });
    load();
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agents</h1>
          <p className="text-sm text-[var(--color-muted)]">
            AI auto-responders. Assign one to a WhatsApp session and it replies
            to incoming 1:1 messages.
          </p>
        </div>
        {!draft && (
          <button onClick={() => setDraft({ ...EMPTY })} className="btn-primary">
            New agent
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {draft && (
        <form onSubmit={save} className="card flex flex-col gap-4">
          <h2 className="font-semibold">
            {draft.id ? "Edit agent" : "New agent"}
          </h2>
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Support Bot"
              required
            />
          </div>
          <div>
            <label className="label">
              Soul <span className="text-[var(--color-muted)]">— personality</span>
            </label>
            <textarea
              className="input min-h-24"
              value={draft.soul}
              onChange={(e) => setDraft({ ...draft, soul: e.target.value })}
              placeholder="Who is this agent? Tone, character, voice. e.g. A warm, concise support rep for Acme who loves helping."
              required
            />
          </div>
          <div>
            <label className="label">
              Instructions{" "}
              <span className="text-[var(--color-muted)]">— behavior</span>
            </label>
            <textarea
              className="input min-h-32"
              value={draft.instructions}
              onChange={(e) =>
                setDraft({ ...draft, instructions: e.target.value })
              }
              placeholder="What should it do and not do? e.g. Answer product and pricing questions. Never quote a refund policy; offer to connect a human instead."
              required
            />
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1">
              <label className="label">Model</label>
              <select
                className="input"
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              >
                {AGENT_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              Enabled
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : draft.id ? "Save changes" : "Create agent"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      ) : agents.length === 0 && !draft ? (
        <div className="card text-sm text-[var(--color-muted)]">
          No agents yet. Create one, then assign it to a session.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {agents.map((a) => (
            <div key={a.id} className="card flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{a.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                    <span className="pill">{a.model}</span>
                    <span>
                      {a.sessionCount} session{a.sessionCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => toggle(a)}
                  className={`badge ${
                    a.enabled
                      ? "bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
                      : "bg-white/10 text-[var(--color-muted)]"
                  }`}
                >
                  {a.enabled ? "Enabled" : "Disabled"}
                </button>
              </div>
              <p className="line-clamp-2 text-sm text-[var(--color-muted)]">
                {a.soul}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    setDraft({
                      id: a.id,
                      name: a.name,
                      soul: a.soul,
                      instructions: a.instructions,
                      model: a.model,
                      enabled: a.enabled,
                    })
                  }
                  className="btn-ghost"
                >
                  Edit
                </button>
                <button onClick={() => remove(a.id)} className="btn-danger">
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
