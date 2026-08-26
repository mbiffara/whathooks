"use client";

import { AgentKnowledge } from "@/components/agent-knowledge";
import { Glyph } from "@/components/glyphs";
import { apiClient } from "@/lib/client-api";
import Link from "next/link";
import { AiTokensCard } from "@/components/ai-tokens-card";
import {
  AGENT_MODELS,
  INCLUDED_AI_MODEL,
  AGENT_PROVIDERS,
  type Agent,
  type AgentProvider,
  type Subscription,
} from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState, Fragment } from "react";

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
  apiKeyHint?: string | null;
  /** Run on whathooks' tokens instead of the org's own key. */
  useIncludedAi: boolean;
  allowAutoStop: boolean;
  notifyOnHandoff: boolean;
  replyDelayMinSeconds: number;
  replyDelayMaxSeconds: number;
  scheduleEnabled: boolean;
  scheduleDays: number[];
  scheduleStart: string; // "HH:MM"
  scheduleEnd: string;
  scheduleTimezone: string;
  enabled: boolean;
  mcpServers: McpServerDraft[];
};

const toHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMinutes = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h % 24) * 60 + (m || 0);
};
const browserTz = () =>
  typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "UTC";

const EMPTY: Draft = {
  name: "",
  soul: "",
  instructions: "",
  provider: "ANTHROPIC",
  model: AGENT_MODELS.ANTHROPIC[0].id,
  apiKey: "",
  useIncludedAi: false,
  allowAutoStop: false,
  notifyOnHandoff: false,
  replyDelayMinSeconds: 0,
  replyDelayMaxSeconds: 0,
  scheduleEnabled: false,
  scheduleDays: [5, 6, 0],
  scheduleStart: "18:00",
  scheduleEnd: "00:00",
  scheduleTimezone: "UTC",
  enabled: true,
  mcpServers: [],
};

/** Plans allowed to configure MCP servers (mirrors the API gate). */
const MCP_PLANS = ["PRO", "BUSINESS", "SPONSORED"];

export default function AgentsPage() {
  const t = useTranslations("dash.agents");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const isOwner = auth?.user?.orgRole === "OWNER";
  const token = auth?.accessToken;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  // Which agent's knowledge section is expanded.
  const [knowledgeId, setKnowledgeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [mcpAllowed, setMcpAllowed] = useState(false);
  const [keyHelpOpen, setKeyHelpOpen] = useState(false);

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
        notifyOnHandoff: draft.allowAutoStop && draft.notifyOnHandoff,
        replyDelayMinSeconds: draft.replyDelayMinSeconds,
        replyDelayMaxSeconds: draft.replyDelayMaxSeconds,
        scheduleEnabled: draft.scheduleEnabled,
        scheduleDays: draft.scheduleDays,
        scheduleStartMinute: toMinutes(draft.scheduleStart),
        scheduleEndMinute: toMinutes(draft.scheduleEnd),
        scheduleTimezone: draft.scheduleTimezone,
        enabled: draft.enabled,
      };
      // Only send the key when the user entered one (blank = keep existing).
      payload.useIncludedAi = draft.useIncludedAi;
      if (!draft.useIncludedAi && draft.apiKey.trim()) {
        payload.apiKey = draft.apiKey.trim();
      }
      // MCP servers: send the list only when the editor was usable, so a
      // Starter org editing an agent never silently clears stored servers.
      if (mcpAllowed) {
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-[var(--color-muted)]">{t("subtitle")}</p>
        </div>
        {!draft && (
          <button
            onClick={() =>
              setDraft({ ...EMPTY, scheduleTimezone: browserTz() })
            }
            className="btn-primary shrink-0"
          >
            {t("newAgent")}
          </button>
        )}
      </div>

      <AiTokensCard isOwner={isOwner} />

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
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              💡 {t("notifyOwnerHint")}
            </p>
          </div>
          <div>
            <label className="label">{t("aiSource")}</label>
            <div
              role="group"
              aria-label={t("aiSource")}
              className="mt-1 inline-flex rounded-full bg-[var(--color-surface-2)] p-1"
            >
              {[false, true].map((included) => (
                <button
                  key={String(included)}
                  type="button"
                  aria-pressed={draft.useIncludedAi === included}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      useIncludedAi: included,
                      // Included AI is one fixed OpenAI model.
                      ...(included
                        ? {
                            provider: "OPENAI" as AgentProvider,
                            model: INCLUDED_AI_MODEL,
                          }
                        : {}),
                    })
                  }
                  className={`inline-flex h-8 items-center rounded-full px-4 text-xs font-semibold transition-colors ${
                    draft.useIncludedAi === included
                      ? "bg-[var(--color-surface)] text-[var(--color-fg)] shadow-sm"
                      : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                  }`}
                >
                  {included ? t("aiIncluded") : t("aiOwnKey")}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              {draft.useIncludedAi ? t("aiIncludedHint") : t("aiOwnKeyHint")}
            </p>
          </div>
          {!draft.useIncludedAi && (
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
                  onChange={(e) =>
                    setDraft({ ...draft, model: e.target.value })
                  }
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
          )}
          {!draft.useIncludedAi && (
            <div>
              <label className="label flex items-center gap-2">
                <span>
                  {t("apiKey")}{" "}
                  <span className="text-[var(--color-muted)]">
                    {draft.provider === "OPENAI" ? "— OpenAI" : "— Anthropic"}
                  </span>
                </span>
                <span className="relative">
                  <button
                    type="button"
                    onClick={() => setKeyHelpOpen((v) => !v)}
                    className="grid h-4 w-4 place-items-center rounded-full border border-[var(--color-border)] text-[10px] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                    aria-label={t("apiKeyHelp")}
                    title={t("apiKeyHelp")}
                  >
                    ?
                  </button>
                  {keyHelpOpen && (
                    <>
                      <span
                        className="fixed inset-0 z-20"
                        onClick={() => setKeyHelpOpen(false)}
                      />
                      <span className="absolute left-0 top-6 z-30 block w-80 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-normal shadow-lg">
                        <span className="block text-sm font-semibold">
                          {t("apiKeyHelpTitle")}
                        </span>
                        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-[var(--color-muted)]">
                          {(
                            t.raw(
                              draft.provider === "OPENAI"
                                ? "openaiSteps"
                                : "anthropicSteps",
                            ) as string[]
                          ).map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                        <a
                          href={
                            draft.provider === "OPENAI"
                              ? "https://platform.openai.com/api-keys"
                              : "https://console.anthropic.com/settings/keys"
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 block text-xs font-medium text-[var(--color-brand)] hover:underline"
                        >
                          {t("openConsole", {
                            provider:
                              draft.provider === "OPENAI"
                                ? "OpenAI"
                                : "Anthropic",
                          })}
                        </a>
                        <span className="mt-1.5 block text-[10px] text-[var(--color-muted)]">
                          {t("byokNote", {
                            provider:
                              draft.provider === "OPENAI"
                                ? "OpenAI"
                                : "Anthropic",
                          })}
                        </span>
                      </span>
                    </>
                  )}
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
                required={!draft.id && !draft.useIncludedAi}
              />
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                {t("apiKeyStoredNote")}
              </p>
            </div>
          )}
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
          <div>
            <label className="label">
              {t("activeHours")}{" "}
              <span className="text-[var(--color-muted)]">
                {t("activeHoursSuffix")}
              </span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDraft({ ...draft, scheduleEnabled: false })}
                className={`rounded-md px-3 py-1.5 text-xs ${
                  !draft.scheduleEnabled
                    ? "bg-[var(--color-surface-2)] font-medium"
                    : "text-[var(--color-muted)]"
                }`}
              >
                {t("alwaysOn")}
              </button>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, scheduleEnabled: true })}
                className={`rounded-md px-3 py-1.5 text-xs ${
                  draft.scheduleEnabled
                    ? "bg-[var(--color-surface-2)] font-medium"
                    : "text-[var(--color-muted)]"
                }`}
              >
                {t("scheduled")}
              </button>
            </div>
            {draft.scheduleEnabled && (
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex items-center gap-1.5">
                  {(t.raw("dayNames") as string[]).map((label, day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          scheduleDays: draft.scheduleDays.includes(day)
                            ? draft.scheduleDays.filter((d) => d !== day)
                            : [...draft.scheduleDays, day],
                        })
                      }
                      className={`grid h-8 w-8 place-items-center rounded-full text-xs font-medium ${
                        draft.scheduleDays.includes(day)
                          ? "bg-[var(--color-brand)] text-[var(--color-on-brand)]"
                          : "border border-[var(--color-border)] text-[var(--color-muted)]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="label">{t("fromTime")}</label>
                    <input
                      type="time"
                      className="input w-28"
                      value={draft.scheduleStart}
                      onChange={(e) =>
                        setDraft({ ...draft, scheduleStart: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="label">{t("toTime")}</label>
                    <input
                      type="time"
                      className="input w-28"
                      value={draft.scheduleEnd}
                      onChange={(e) =>
                        setDraft({ ...draft, scheduleEnd: e.target.value })
                      }
                    />
                  </div>
                  <div className="min-w-48 flex-1">
                    <label className="label">{t("timezone")}</label>
                    <select
                      className="input"
                      value={draft.scheduleTimezone}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          scheduleTimezone: e.target.value,
                        })
                      }
                    >
                      {[
                        ...new Set([
                          draft.scheduleTimezone,
                          browserTz(),
                          ...(typeof Intl.supportedValuesOf === "function"
                            ? Intl.supportedValuesOf("timeZone")
                            : ["UTC"]),
                        ]),
                      ].map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-[var(--color-muted)]">
                  {t("scheduleHint")}
                </p>
              </div>
            )}
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
          {draft.allowAutoStop && (
            <label className="ml-6 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={draft.notifyOnHandoff}
                onChange={(e) =>
                  setDraft({ ...draft, notifyOnHandoff: e.target.checked })
                }
              />
              <span>
                {t("notifyOnHandoff")}
                <span className="block text-xs text-[var(--color-muted)]">
                  {t("notifyOnHandoffNote")}
                </span>
              </span>
            </label>
          )}
          <div>
            <label className="label">{t("mcpTools")}</label>
            {!mcpAllowed ? (
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
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase text-[var(--color-muted)]">
                <th className="px-4 py-3 font-medium">{t("colAgent")}</th>
                <th className="px-4 py-3 font-medium">{t("colModel")}</th>
                <th className="px-4 py-3 font-medium">{t("colSessions")}</th>
                <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <Fragment key={a.id}>
                  <tr className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{a.name}</div>
                      <div className="mt-0.5 line-clamp-1 max-w-xs text-xs text-[var(--color-muted)]">
                        {a.soul}
                      </div>
                      {a.enabled && a.sessionCount === 0 && (
                        <div className="mt-1 text-xs text-[var(--color-warning)]">
                          ⚠ {t("unlinkedWarning")}{" "}
                          <Link
                            href="/dashboard/sessions"
                            className="font-medium underline"
                          >
                            {t("goToSessions")}
                          </Link>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="pill">
                          {a.useIncludedAi
                            ? t("aiIncluded")
                            : a.provider === "OPENAI"
                              ? "OpenAI"
                              : "Anthropic"}
                        </span>
                        <span className="pill">{a.model}</span>
                        {(a.mcpServers?.length ?? 0) > 0 && (
                          <span className="pill border-[var(--color-brand)]/40 text-[var(--color-brand)]">
                            MCP · {a.mcpServers.length}
                          </span>
                        )}
                      </div>
                      {a.scheduleEnabled && (
                        <div className="mt-1 text-xs text-[var(--color-muted)]">
                          🕒 {toHHMM(a.scheduleStartMinute)}–
                          {toHHMM(a.scheduleEndMinute)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-muted)]">
                      {a.sessionCount}
                    </td>
                    <td className="px-4 py-3">
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
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
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
                              useIncludedAi: a.useIncludedAi,
                              allowAutoStop: a.allowAutoStop,
                              notifyOnHandoff: a.notifyOnHandoff,
                              replyDelayMinSeconds: a.replyDelayMinSeconds,
                              replyDelayMaxSeconds: a.replyDelayMaxSeconds,
                              scheduleEnabled: a.scheduleEnabled,
                              scheduleDays: a.scheduleDays,
                              scheduleStart: toHHMM(a.scheduleStartMinute),
                              scheduleEnd: toHHMM(a.scheduleEndMinute),
                              scheduleTimezone: a.scheduleTimezone,
                              enabled: a.enabled,
                              mcpServers: (a.mcpServers ?? []).map((srv) => ({
                                name: srv.name,
                                url: srv.url,
                                authToken: "",
                                hasAuth: srv.hasAuth,
                                authTokenHint: srv.authTokenHint,
                              })),
                            })
                          }
                          aria-label={tc("edit")}
                          title={tc("edit")}
                          className="rounded-lg p-1.5 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                        >
                          <Glyph name="pencil" size={16} />
                        </button>
                        <button
                          onClick={() =>
                            setKnowledgeId((v) => (v === a.id ? null : a.id))
                          }
                          aria-label={t("knowledge.button")}
                          title={t("knowledge.button")}
                          className={`rounded-lg p-1.5 hover:text-[var(--color-fg)] ${
                            knowledgeId === a.id
                              ? "text-[var(--color-brand)]"
                              : "text-[var(--color-muted)]"
                          }`}
                        >
                          <Glyph name="docs" size={16} />
                        </button>
                        <button
                          onClick={() => remove(a.id)}
                          aria-label={tc("delete")}
                          title={tc("delete")}
                          className="rounded-lg p-1.5 text-[var(--color-muted)] hover:text-[var(--color-danger)]"
                        >
                          <Glyph name="trash" size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {knowledgeId === a.id && (
                    <tr className="border-b border-[var(--color-border)]">
                      <td
                        colSpan={5}
                        className="bg-[var(--color-surface-2)] px-4 py-3"
                      >
                        <AgentKnowledge agentId={a.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
