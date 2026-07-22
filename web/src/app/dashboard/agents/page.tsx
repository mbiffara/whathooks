"use client";

import { apiClient } from "@/lib/client-api";
import Link from "next/link";
import {
  AGENT_MODELS,
  AGENT_PROVIDERS,
  type Agent,
  type AgentProvider,
  type Subscription,
} from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

type McpServerDraft = {
  name: string;
  url: string;
  authToken: string; // blank on edit = keep existing token
  hasAuth: boolean;
  authTokenHint: string | null;
};

type Draft = {
  id?: string;
  name: string;
  soul: string;
  instructions: string;
  provider: AgentProvider;
  model: string;
  apiKey: string; // blank on edit = keep existing
  apiKeyHint?: string;
  allowAutoStop: boolean;
  replyDelayMinSeconds: number;
  replyDelayMaxSeconds: number;
  enabled: boolean;
  mcpServers: McpServerDraft[];
};

const EMPTY: Draft = {
  name: "",
  soul: "",
  instructions: "",
  provider: "ANTHROPIC",
  model: AGENT_MODELS.ANTHROPIC[0].id,
  apiKey: "",
  allowAutoStop: false,
  replyDelayMinSeconds: 0,
  replyDelayMaxSeconds: 0,
  enabled: true,
  mcpServers: [],
};

/** Plans allowed to configure MCP servers (mirrors the API gate). */
const MCP_PLANS = ["PRO", "BUSINESS", "SPONSORED"];

export default function AgentsPage() {
  const t = useTranslations("dash.agents");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [mcpAllowed, setMcpAllowed] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setAgents(await apiClient<Agent[]>("/agents", token));
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    } finally {
      setLoading(false);
    }
    // Best-effort plan check for the MCP editor (API enforces it regardless).
    apiClient<Subscription>("/billing/subscription", token)
      .then((sub) => setMcpAllowed(MCP_PLANS.includes(sub.plan)))
      .catch(() => {});
  }, [token, tc]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: draft.name,
        soul: draft.soul,
        instructions: draft.instructions,
        provider: draft.provider,
        model: draft.model,
        allowAutoStop: draft.allowAutoStop,
        replyDelayMinSeconds: draft.replyDelayMinSeconds,
        replyDelayMaxSeconds: draft.replyDelayMaxSeconds,
        enabled: draft.enabled,
      };
      // Only send the key when the user entered one (blank = keep existing).
      if (draft.apiKey.trim()) payload.apiKey = draft.apiKey.trim();
      // MCP servers: send the list only when the editor was usable, so a
      // Starter org editing an agent never silently clears stored servers.
      // Switching to OpenAI clears them explicitly (MCP is Anthropic-only).
      if (draft.provider === "OPENAI") {
        payload.mcpServers = [];
      } else if (mcpAllowed) {
        payload.mcpServers = draft.mcpServers
          .filter((s) => s.name.trim() && s.url.trim())
          .map((s) => ({
            name: s.name.trim(),
            url: s.url.trim(),
            ...(s.authToken.trim() ? { authToken: s.authToken.trim() } : {}),
          }));
      }
      const body = JSON.stringify(payload);
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
      setError(e instanceof Error ? e.message : t("failedToSave"));
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
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-[var(--color-muted)]">{t("subtitle")}</p>
        </div>
        {!draft && (
          <button
            onClick={() => setDraft({ ...EMPTY })}
            className="btn-primary"
          >
            {t("newAgent")}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      {draft && (
        <form onSubmit={save} className="card flex flex-col gap-4">
          <h2 className="font-semibold">
            {draft.id ? t("editAgent") : t("newAgent")}
          </h2>
          <div>
            <label className="label">{t("name")}</label>
            <input
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={t("namePlaceholder")}
              required
            />
          </div>
          <div>
            <label className="label">
              {t("soul")}{" "}
              <span className="text-[var(--color-muted)]">
                {t("soulSuffix")}
              </span>
            </label>
            <textarea
              className="input min-h-24"
              value={draft.soul}
              onChange={(e) => setDraft({ ...draft, soul: e.target.value })}
              placeholder={t("soulPlaceholder")}
              required
            />
          </div>
          <div>
            <label className="label">
              {t("instructions")}{" "}
              <span className="text-[var(--color-muted)]">
                {t("instructionsSuffix")}
              </span>
            </label>
            <textarea
              className="input min-h-32"
              value={draft.instructions}
              onChange={(e) =>
                setDraft({ ...draft, instructions: e.target.value })
              }
              placeholder={t("instructionsPlaceholder")}
              required
            />
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-40">
              <label className="label">{t("provider")}</label>
              <select
                className="input"
                value={draft.provider}
                onChange={(e) => {
                  const provider = e.target.value as AgentProvider;
                  // Reset the model to the new provider's default.
                  setDraft({
                    ...draft,
                    provider,
                    model: AGENT_MODELS[provider][0].id,
                  });
                }}
              >
                {AGENT_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-40">
              <label className="label">{t("model")}</label>
              <select
                className="input"
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              >
                {/* Keep an existing agent's stored model selectable even if it's
                    no longer in our suggested list, so editing doesn't reset it. */}
                {!AGENT_MODELS[draft.provider].some(
                  (m) => m.id === draft.model,
                ) &&
                  draft.model && (
                    <option value={draft.model}>
                      {t("modelCurrent", { model: draft.model })}
                    </option>
                  )}
                {AGENT_MODELS[draft.provider].map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">
              {t("apiKey")}{" "}
              <span className="text-[var(--color-muted)]">
                {draft.provider === "OPENAI" ? "— OpenAI" : "— Anthropic"}
              </span>
            </label>
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder={
                draft.id
                  ? t("apiKeyKeepPlaceholder", {
                      hint: draft.apiKeyHint ?? "•••",
                    })
                  : draft.provider === "OPENAI"
                    ? "sk-…"
                    : "sk-ant-…"
              }
              required={!draft.id}
            />
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              {t("apiKeyStoredNote")}
            </p>
          </div>
          <div>
            <label className="label">
              {t("replyDelay")}{" "}
              <span className="text-[var(--color-muted)]">
                {t("replyDelaySuffix")}
              </span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={300}
                className="input w-24"
                value={draft.replyDelayMinSeconds}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    replyDelayMinSeconds: Math.max(
                      0,
                      Number(e.target.value) || 0,
                    ),
                  })
                }
                aria-label={t("minDelayAria")}
              />
              <span className="text-sm text-[var(--color-muted)]">
                {t("to")}
              </span>
              <input
                type="number"
                min={0}
                max={300}
                className="input w-24"
                value={draft.replyDelayMaxSeconds}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    replyDelayMaxSeconds: Math.max(
                      0,
                      Number(e.target.value) || 0,
                    ),
                  })
                }
                aria-label={t("maxDelayAria")}
              />
            </div>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              {t("replyDelayNote")}
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={draft.allowAutoStop}
              onChange={(e) =>
                setDraft({ ...draft, allowAutoStop: e.target.checked })
              }
            />
            <span>
              {t("allowAutoStop")}
              <span className="block text-xs text-[var(--color-muted)]">
                {t("allowAutoStopNote")}
              </span>
            </span>
          </label>
          <div>
            <label className="label">
              {t("mcpTools")}{" "}
              <span className="text-[var(--color-muted)]">
                {t("mcpSuffix")}
              </span>
            </label>
            {draft.provider === "OPENAI" ? (
              <p className="text-xs text-[var(--color-muted)]">
                {t("mcpOpenaiNote")}
                {draft.mcpServers.length > 0 && t("mcpOpenaiClearWarning")}
              </p>
            ) : !mcpAllowed ? (
              <p className="text-xs text-[var(--color-muted)]">
                {t.rich("mcpUpgrade", {
                  link: (c) => (
                    <Link
                      href="/dashboard/billing"
                      className="text-[var(--color-brand)] hover:underline"
                    >
                      {c}
                    </Link>
                  ),
                })}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-[var(--color-muted)]">
                  {t("mcpNote")}
                </p>
                {draft.mcpServers.map((s, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2"
                  >
                    <input
                      className="input h-9 w-36 flex-none text-xs"
                      placeholder={t("mcpNamePlaceholder")}
                      value={s.name}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          mcpServers: draft.mcpServers.map((row, j) =>
                            j === i ? { ...row, name: e.target.value } : row,
                          ),
                        })
                      }
                    />
                    <input
                      className="input h-9 min-w-48 flex-1 text-xs"
                      placeholder="https://mcp.example.com/mcp"
                      value={s.url}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          mcpServers: draft.mcpServers.map((row, j) =>
                            j === i ? { ...row, url: e.target.value } : row,
                          ),
                        })
                      }
                    />
                    <input
                      className="input h-9 w-44 flex-none text-xs"
                      type="password"
                      autoComplete="off"
                      placeholder={
                        s.hasAuth
                          ? t("mcpTokenUnchanged", {
                              hint: s.authTokenHint ?? "•••",
                            })
                          : t("mcpTokenOptional")
                      }
                      value={s.authToken}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          mcpServers: draft.mcpServers.map((row, j) =>
                            j === i
                              ? { ...row, authToken: e.target.value }
                              : row,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          mcpServers: draft.mcpServers.filter(
                            (_, j) => j !== i,
                          ),
                        })
                      }
                      className="btn-ghost h-9 px-2 text-xs"
                      aria-label={t("removeMcp")}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {draft.mcpServers.length < 5 && (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        mcpServers: [
                          ...draft.mcpServers,
                          {
                            name: "",
                            url: "",
                            authToken: "",
                            hasAuth: false,
                            authTokenHint: null,
                          },
                        ],
                      })
                    }
                    className="btn-ghost self-start text-xs"
                  >
                    {t("addMcp")}
                  </button>
                )}
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) =>
                setDraft({ ...draft, enabled: e.target.checked })
              }
            />
            {t("enabledLabel")}
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving
                ? tc("saving")
                : draft.id
                  ? t("saveChanges")
                  : t("createAgent")}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setDraft(null)}
            >
              {tc("cancel")}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
      ) : agents.length === 0 && !draft ? (
        <div className="card text-sm text-[var(--color-muted)]">
          {t("noAgents")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {agents.map((a) => (
            <div key={a.id} className="card flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{a.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                    <span className="pill">
                      {a.provider === "OPENAI" ? "OpenAI" : "Anthropic"}
                    </span>
                    <span className="pill">{a.model}</span>
                    {(a.mcpServers?.length ?? 0) > 0 && (
                      <span className="pill border-[var(--color-brand)]/40 text-[var(--color-brand)]">
                        MCP · {a.mcpServers.length}
                      </span>
                    )}
                    <span>{t("sessionCount", { count: a.sessionCount })}</span>
                  </div>
                </div>
                <button
                  onClick={() => toggle(a)}
                  className={`badge ${
                    a.enabled
                      ? "bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
                      : "bg-[var(--color-chip)] text-[var(--color-muted)]"
                  }`}
                >
                  {a.enabled ? tc("enabled") : tc("disabled")}
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
                      provider: a.provider,
                      model: a.model,
                      apiKey: "",
                      apiKeyHint: a.apiKeyHint,
                      allowAutoStop: a.allowAutoStop,
                      replyDelayMinSeconds: a.replyDelayMinSeconds,
                      replyDelayMaxSeconds: a.replyDelayMaxSeconds,
                      enabled: a.enabled,
                      mcpServers: (a.mcpServers ?? []).map((s) => ({
                        name: s.name,
                        url: s.url,
                        authToken: "",
                        hasAuth: s.hasAuth,
                        authTokenHint: s.authTokenHint,
                      })),
                    })
                  }
                  className="btn-ghost"
                >
                  {tc("edit")}
                </button>
                <button onClick={() => remove(a.id)} className="btn-danger">
                  {tc("delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
