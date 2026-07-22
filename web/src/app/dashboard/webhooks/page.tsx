"use client";

import { apiClient } from "@/lib/client-api";
import type { MappingRule, WaSession, Webhook } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

const EVENTS = ["message.received", "session.status", "session.qr"];

/** Source paths offered in the editor (free text is also allowed). */
const SOURCE_SUGGESTIONS = [
  "data.id",
  "data.from",
  "data.pushName",
  "data.type",
  "data.text",
  "data.media.url",
  "data.media.mimeType",
  "data.media.fileName",
  "data.waMessageId",
  "data.timestamp",
  "data.conversationId",
  "event",
  "sessionId",
  "timestamp",
];

/** Editable row: a MappingRule plus which kind the user picked. */
interface RuleRow {
  target: string;
  kind: "field" | "fixed";
  source: string;
  value: string;
  dateFormat: string;
}

const emptyRow = (): RuleRow => ({
  target: "",
  kind: "field",
  source: "",
  value: "",
  dateFormat: "",
});

function rowsToRules(rows: RuleRow[]): MappingRule[] {
  return rows
    .filter((r) => r.target.trim())
    .map((r) =>
      r.kind === "fixed"
        ? { target: r.target.trim(), value: r.value }
        : {
            target: r.target.trim(),
            source: r.source.trim(),
            ...(r.dateFormat.trim() ? { dateFormat: r.dateFormat.trim() } : {}),
          },
    )
    .filter((r) => ("source" in r ? Boolean(r.source) : true));
}

function rulesToRows(rules: MappingRule[] | null): RuleRow[] {
  if (!rules?.length) return [];
  return rules.map((r) => ({
    target: r.target,
    kind: r.source !== undefined ? "field" : "fixed",
    source: r.source ?? "",
    value: r.value == null ? "" : String(r.value),
    dateFormat: r.dateFormat ?? "",
  }));
}

function MappingEditor({
  rows,
  onChange,
}: {
  rows: RuleRow[];
  onChange: (rows: RuleRow[]) => void;
}) {
  const t = useTranslations("dash.webhooks");
  function patch(i: number, changes: Partial<RuleRow>) {
    onChange(rows.map((row, j) => (j === i ? { ...row, ...changes } : row)));
  }

  return (
    <div className="flex flex-col gap-2">
      <datalist id="wh-source-paths">
        {SOURCE_SUGGESTIONS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2"
        >
          <input
            className="input h-9 w-36 flex-none text-xs"
            placeholder="output_field"
            value={row.target}
            onChange={(e) => patch(i, { target: e.target.value })}
          />
          <span className="text-xs text-[var(--color-muted)]">←</span>
          <select
            className="input h-9 w-28 flex-none text-xs"
            value={row.kind}
            onChange={(e) =>
              patch(i, { kind: e.target.value as RuleRow["kind"] })
            }
          >
            <option value="field">{t("kindField")}</option>
            <option value="fixed">{t("kindFixed")}</option>
          </select>
          {row.kind === "field" ? (
            <>
              <input
                className="input h-9 min-w-36 flex-1 text-xs"
                placeholder="data.from"
                list="wh-source-paths"
                value={row.source}
                onChange={(e) => patch(i, { source: e.target.value })}
              />
              <input
                className="input h-9 w-40 flex-none text-xs"
                placeholder={t("dateFormatPlaceholder")}
                title={t("dateFormatTitle")}
                value={row.dateFormat}
                onChange={(e) => patch(i, { dateFormat: e.target.value })}
              />
            </>
          ) : (
            <input
              className="input h-9 min-w-36 flex-1 text-xs"
              placeholder={t("valuePlaceholder")}
              value={row.value}
              onChange={(e) => patch(i, { value: e.target.value })}
            />
          )}
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="btn-ghost h-9 px-2 text-xs"
            aria-label={t("removeField")}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange([...rows, emptyRow()])}
          className="btn-ghost self-start text-xs"
        >
          {t("addField")}
        </button>
        {rows.length > 0 && (
          <p className="text-xs text-[var(--color-muted)]">
            {t.rich("mappingHint", { code: (c) => <code>{c}</code> })}
          </p>
        )}
      </div>
    </div>
  );
}

export default function WebhooksPage() {
  const t = useTranslations("dash.webhooks");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["message.received"]);
  const [sessionId, setSessionId] = useState("");
  const [mappingRows, setMappingRows] = useState<RuleRow[]>([]);
  const [showMapping, setShowMapping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  // Per-hook mapping editor (id of the hook being edited + its draft rows).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRows, setEditRows] = useState<RuleRow[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

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
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [token, tc]);

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
      const payloadMapping = rowsToRules(mappingRows);
      const created = await apiClient<Webhook>("/webhooks", token, {
        method: "POST",
        body: JSON.stringify({
          url,
          events,
          sessionId: sessionId || undefined,
          ...(payloadMapping.length ? { payloadMapping } : {}),
        }),
      });
      setNewSecret(created.secret ?? null);
      setUrl("");
      setMappingRows([]);
      setShowMapping(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToCreate"));
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

  function startEditMapping(h: Webhook) {
    setEditingId(h.id);
    setEditRows(rulesToRows(h.payloadMapping));
    setError(null);
  }

  async function saveMapping(id: string) {
    if (!token) return;
    setSavingEdit(true);
    setError(null);
    try {
      await apiClient(`/webhooks/${id}`, token, {
        method: "PATCH",
        // An empty list clears the mapping (back to the default payload).
        body: JSON.stringify({ payloadMapping: rowsToRules(editRows) }),
      });
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToSaveMapping"));
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-[var(--color-muted)]">{t("subtitle")}</p>
      </div>

      <form onSubmit={create} className="card flex flex-col gap-4">
        <div>
          <label className="label">{t("endpointUrl")}</label>
          <input
            className="input"
            placeholder="https://yourapp.com/webhooks/whathooks"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">{t("events")}</label>
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
          <label className="label">{t("scopeOptional")}</label>
          <select
            className="input"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
          >
            <option value="">{t("allSessions")}</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <button
            type="button"
            onClick={() => {
              setShowMapping((v) => !v);
              if (!showMapping && mappingRows.length === 0) {
                setMappingRows([emptyRow()]);
              }
            }}
            className="text-sm text-[var(--color-brand)] hover:underline"
          >
            {showMapping ? "▾" : "▸"} {t("customizePayload")}
          </button>
          {showMapping && (
            <div className="mt-3">
              <MappingEditor rows={mappingRows} onChange={setMappingRows} />
            </div>
          )}
        </div>
        <button
          type="submit"
          className="btn-primary self-start"
          disabled={!events.length}
        >
          {t("addWebhook")}
        </button>
      </form>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      {newSecret && (
        <div className="card border-[var(--color-brand)]/40">
          <p className="text-sm font-medium">{t("secretNotice")}</p>
          <code className="mt-2 block break-all rounded-lg bg-[var(--color-surface-2)] p-3 font-mono text-sm text-[var(--color-accent)]">
            {newSecret}
          </code>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
      ) : hooks.length === 0 ? (
        <div className="card text-sm text-[var(--color-muted)]">
          {t("noWebhooks")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {hooks.map((h) => (
            <div key={h.id} className="card flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm">{h.url}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {h.events.map((ev) => (
                      <span key={ev} className="pill">
                        {ev}
                      </span>
                    ))}
                    {(h.payloadMapping?.length ?? 0) > 0 && (
                      <span className="pill border-[var(--color-brand)]/40 text-[var(--color-brand)]">
                        {t("customPayload", {
                          count: h.payloadMapping!.length,
                        })}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-muted)]">
                    {t("secretHint", { hint: h.secretHint })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() =>
                      editingId === h.id
                        ? setEditingId(null)
                        : startEditMapping(h)
                    }
                    className="btn-ghost"
                  >
                    {editingId === h.id ? tc("close") : t("mapping")}
                  </button>
                  <button onClick={() => toggleActive(h)} className="btn-ghost">
                    {h.active ? tc("disable") : tc("enable")}
                  </button>
                  <button onClick={() => remove(h.id)} className="btn-danger">
                    {tc("delete")}
                  </button>
                </div>
              </div>
              {editingId === h.id && (
                <div className="border-t border-[var(--color-border)] pt-3">
                  <MappingEditor rows={editRows} onChange={setEditRows} />
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => saveMapping(h.id)}
                      disabled={savingEdit}
                      className="btn-primary text-xs"
                    >
                      {savingEdit ? tc("saving") : t("saveMapping")}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="btn-ghost text-xs"
                    >
                      {tc("cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
