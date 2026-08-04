"use client";

import { Glyph } from "@/components/glyphs";
import { WebhookDeliveries } from "@/components/webhook-deliveries";
import {
  MappingEditor,
  RuleRow,
  mappingsToRowsByEvent,
  rowsByEventToMappings,
} from "@/components/webhook-mapping-editor";
import { apiClient } from "@/lib/client-api";
import type { WaSession, Webhook } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function WebhookDetailPage() {
  const t = useTranslations("dash.webhooks");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const router = useRouter();

  const [hook, setHook] = useState<Webhook | null>(null);
  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rowsByEvent, setRowsByEvent] = useState<Record<string, RuleRow[]>>(
    {},
  );
  const [savingMapping, setSavingMapping] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [h, s] = await Promise.all([
        apiClient<Webhook>(`/webhooks/${id}`, token),
        apiClient<WaSession[]>("/sessions", token).catch(() => []),
      ]);
      setHook(h);
      setSessions(s);
      setRowsByEvent(mappingsToRowsByEvent(h.payloadMapping, h.events));
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    }
  }, [token, id, tc]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive() {
    if (!token || !hook || busy) return;
    setBusy(true);
    try {
      await apiClient(`/webhooks/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ active: !hook.active }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!token || busy) return;
    setBusy(true);
    try {
      await apiClient(`/webhooks/${id}`, token, { method: "DELETE" });
      router.push("/dashboard/webhooks");
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
      setBusy(false);
    }
  }

  async function saveMapping() {
    if (!token) return;
    setSavingMapping(true);
    setError(null);
    try {
      await apiClient(`/webhooks/${id}`, token, {
        method: "PATCH",
        // An empty object clears every mapping (back to default payloads).
        body: JSON.stringify({
          payloadMapping: rowsByEventToMappings(rowsByEvent),
        }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToSaveMapping"));
    } finally {
      setSavingMapping(false);
    }
  }

  if (!hook) {
    return (
      <p className="text-sm text-[var(--color-muted)]">
        {error ?? tc("loading")}
      </p>
    );
  }

  const scopeLabel = hook.sessionId
    ? (sessions.find((s) => s.id === hook.sessionId)?.label ?? hook.sessionId)
    : t("allSessions");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <button
            onClick={() => router.push("/dashboard/webhooks")}
            className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            <Glyph name="chevronLeft" size={14} />
            {t("title")}
          </button>
          <h1 className="truncate font-mono text-xl font-bold">{hook.url}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`badge ${
                hook.active
                  ? "bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
                  : "bg-[var(--color-chip)] text-[var(--color-muted)]"
              }`}
            >
              {hook.active ? tc("enabled") : tc("disabled")}
            </span>
            {hook.events.map((ev) => (
              <span key={ev} className="pill">
                {ev}
              </span>
            ))}
            <span className="text-[var(--color-muted)]">
              {t("scopeLabel")}: {scopeLabel}
            </span>
            <span className="text-[var(--color-muted)]">
              {t("secretHint", { hint: hook.secretHint })}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={toggleActive} disabled={busy} className="btn-ghost">
            {hook.active ? tc("disable") : tc("enable")}
          </button>
          <button onClick={remove} disabled={busy} className="btn-danger">
            {tc("delete")}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      <div className="card">
        <h2 className="mb-3 font-semibold">{t("customizePayload")}</h2>
        <div className="flex flex-col gap-4">
          <p className="text-xs text-[var(--color-muted)]">
            {t("mappingEventsHint")}
          </p>
          {hook.events.map((ev) => (
            <div key={ev}>
              <div className="mb-1.5 text-xs font-semibold">
                {t("mappingFor", { event: ev })}
              </div>
              <MappingEditor
                event={ev}
                rows={rowsByEvent[ev] ?? []}
                onChange={(rows) =>
                  setRowsByEvent((m) => ({ ...m, [ev]: rows }))
                }
              />
            </div>
          ))}
        </div>
        <div className="mt-3">
          <button
            onClick={saveMapping}
            disabled={savingMapping}
            className="btn-primary text-xs"
          >
            {savingMapping ? tc("saving") : t("saveMapping")}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 font-semibold">{t("deliveries")}</h2>
        <WebhookDeliveries webhookId={hook.id} />
      </div>
    </div>
  );
}
