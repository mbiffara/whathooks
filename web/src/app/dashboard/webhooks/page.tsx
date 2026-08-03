"use client";

import { Glyph } from "@/components/glyphs";
import { UpgradeModal } from "@/components/upgrade-modal";
import {
  MappingEditor,
  RuleRow,
  WEBHOOK_EVENTS,
  emptyRow,
  rowsToRules,
} from "@/components/webhook-mapping-editor";
import { apiClient, isSubscriptionRequired } from "@/lib/client-api";
import Link from "next/link";
import type { MappingRule, WaSession, Webhook } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

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
  const [showUpgrade, setShowUpgrade] = useState(false);

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
      if (isSubscriptionRequired(e)) {
        setShowUpgrade(true);
      } else {
        setError(e instanceof Error ? e.message : tc("failedToCreate"));
      }
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
            {WEBHOOK_EVENTS.map((ev) => (
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
      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        action={t("upgradeAction")}
      />
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
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/webhooks/${h.id}`}
                    className="block truncate font-mono text-sm hover:text-[var(--color-brand)]"
                  >
                    {h.url}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {!h.active && (
                      <span className="badge bg-[var(--color-chip)] text-[var(--color-muted)]">
                        {tc("disabled")}
                      </span>
                    )}
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
                  <button onClick={() => toggleActive(h)} className="btn-ghost">
                    {h.active ? tc("disable") : tc("enable")}
                  </button>
                  <button onClick={() => remove(h.id)} className="btn-danger">
                    {tc("delete")}
                  </button>
                  <Link
                    href={`/dashboard/webhooks/${h.id}`}
                    className="inline-flex items-center gap-0.5 text-sm text-[var(--color-brand)]"
                  >
                    {t("view")}
                    <Glyph name="chevronRight" size={14} />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
