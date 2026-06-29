"use client";

import { apiClient } from "@/lib/client-api";
import type { ApiKey } from "@/lib/types";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

export default function ApiKeysPage() {
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setKeys(await apiClient<ApiKey[]>("/api-keys", token));
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
    if (!token || !name.trim()) return;
    setError(null);
    setNewToken(null);
    try {
      const created = await apiClient<ApiKey>("/api-keys", token, {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      setNewToken(created.token ?? null);
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    }
  }

  async function revoke(id: string) {
    if (!token) return;
    await apiClient(`/api-keys/${id}`, token, { method: "DELETE" });
    load();
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">API Keys</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Use these to send messages via <span className="pill">POST /v1/messages</span>{" "}
          with the <span className="pill">X-API-Key</span> header.
        </p>
      </div>

      <form onSubmit={create} className="card flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="label">Key name</label>
          <input
            className="input"
            placeholder="e.g. Production server"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={!name.trim()}>
          Generate key
        </button>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {newToken && (
        <div className="card border-[var(--color-brand)]/40">
          <p className="text-sm font-medium">
            Your new API key — copy it now, it won’t be shown again:
          </p>
          <code className="mt-2 block break-all rounded-lg bg-[var(--color-surface-2)] p-3 font-mono text-sm text-[var(--color-accent)]">
            {newToken}
          </code>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      ) : keys.length === 0 ? (
        <div className="card text-sm text-[var(--color-muted)]">No API keys yet.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {keys.map((k) => (
            <div key={k.id} className="card flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">
                  {k.name}
                  {k.revokedAt && (
                    <span className="ml-2 badge bg-red-500/15 text-red-300">revoked</span>
                  )}
                </div>
                <div className="mt-1 font-mono text-sm text-[var(--color-muted)]">
                  {k.prefix}
                </div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  {k.lastUsedAt
                    ? `Last used ${new Date(k.lastUsedAt).toLocaleString()}`
                    : "Never used"}
                </div>
              </div>
              {!k.revokedAt && (
                <button onClick={() => revoke(k.id)} className="btn-danger">
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
