"use client";

import { ApiKeyForm } from "@/components/api-key-form";
import { apiClient } from "@/lib/client-api";
import type { ApiKey, WaSession } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

export default function ApiKeysPage() {
  const t = useTranslations("dash.apiKeys");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setKeys(await apiClient<ApiKey[]>("/api-keys", token));
      // Best-effort: without them the session picker is simply absent, which
      // means "all sessions" and is the pre-scoping behaviour anyway.
      setSessions(
        await apiClient<WaSession[]>("/sessions", token).catch(() => []),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [token, tc]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(v: {
    name: string;
    scopes: string[];
    sessionIds: string[];
  }) {
    if (!token) return;
    setError(null);
    setNewToken(null);
    setBusy(true);
    try {
      const created = await apiClient<ApiKey>("/api-keys", token, {
        method: "POST",
        body: JSON.stringify(v),
      });
      setNewToken(created.token ?? null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToCreate"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!token) return;
    await apiClient(`/api-keys/${id}`, token, { method: "DELETE" });
    load();
  }

  /** Permanent, and only offered once a key is revoked. */
  async function remove(id: string) {
    if (!token || !confirm(t("deleteConfirm"))) return;
    setError(null);
    try {
      await apiClient(`/api-keys/${id}/permanent`, token, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-[var(--color-muted)]">
          {t.rich("subtitle", {
            post: () => <span className="pill">POST /v1/messages</span>,
            key: () => <span className="pill">X-API-Key</span>,
          })}
        </p>
      </div>

      <ApiKeyForm sessions={sessions} busy={busy} onCreate={create} />

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      {newToken && (
        <div className="card border-[var(--color-brand)]/40">
          <p className="text-sm font-medium">{t("newKeyNotice")}</p>
          <code className="mt-2 block break-all rounded-lg bg-[var(--color-surface-2)] p-3 font-mono text-sm text-[var(--color-accent)]">
            {newToken}
          </code>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
      ) : keys.length === 0 ? (
        <div className="card text-sm text-[var(--color-muted)]">
          {t("noKeys")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {keys.map((k) => (
            <div
              key={k.id}
              className="card flex flex-wrap items-center justify-between gap-4"
            >
              <div>
                <div className="font-medium">
                  {k.name}
                  {k.revokedAt && (
                    <span className="ml-2 badge bg-[var(--color-danger-bg)] text-[var(--color-danger)]">
                      {t("revoked")}
                    </span>
                  )}
                </div>
                <div className="mt-1 font-mono text-sm text-[var(--color-muted)]">
                  {k.prefix}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {k.scopes?.length ? (
                    k.scopes.map((sc) => (
                      <span key={sc} className="pill text-xs">
                        {sc}
                      </span>
                    ))
                  ) : (
                    <span className="pill text-xs text-[var(--color-danger)]">
                      {t("noScopes")}
                    </span>
                  )}
                  {k.sessionIds?.length > 0 && (
                    <span className="pill text-xs">
                      {t("limitedToSessions", { n: k.sessionIds.length })}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  {k.lastUsedAt
                    ? t("lastUsed", {
                        date: new Date(k.lastUsedAt).toLocaleString(),
                      })
                    : t("neverUsed")}
                </div>
              </div>
              {k.revokedAt ? (
                <button onClick={() => remove(k.id)} className="btn-danger">
                  {t("delete")}
                </button>
              ) : (
                <button onClick={() => revoke(k.id)} className="btn-danger">
                  {t("revoke")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
