"use client";

import { StatusBadge } from "@/components/status-badge";
import { apiClient } from "@/lib/client-api";
import type { WaStatus } from "@/lib/types";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface MirrorSession {
  id: string;
  label: string;
  phoneNumber: string | null;
  status: WaStatus;
  organization: string;
}

interface MirrorLink {
  id: string;
  enabled: boolean;
  repNumber: string;
  createdAt: string;
  threads: number;
  session: Omit<MirrorSession, "organization">;
  organization: string;
}

/**
 * Platform-admin experiment: relay DMs on a session into per-lead groups with
 * a sales rep, hiding the lead's number. English-only (admin console).
 */
export default function MirrorLinksPage() {
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [links, setLinks] = useState<MirrorLink[]>([]);
  const [sessions, setSessions] = useState<MirrorSession[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [repNumber, setRepNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiClient<{
        links: MirrorLink[];
        sessions: MirrorSession[];
      }>("/admin/mirror-links", token);
      setLinks(data.links);
      setSessions(data.sessions);
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
      await apiClient("/admin/mirror-links", token, {
        method: "POST",
        body: JSON.stringify({ sessionId, repNumber: repNumber.trim() }),
      });
      setSessionId("");
      setRepNumber("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(link: MirrorLink) {
    if (!token || busy) return;
    setBusy(true);
    try {
      await apiClient(`/admin/mirror-links/${link.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !link.enabled }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!token || busy) return;
    setBusy(true);
    try {
      await apiClient(`/admin/mirror-links/${id}`, token, {
        method: "DELETE",
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin"
          className="mb-2 block text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold">
          Mirror links{" "}
          <span className="badge bg-[var(--color-warning-bg)] text-[var(--color-warning)] align-middle text-xs">
            experimental
          </span>
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          DMs to a mirrored session are relayed into a per-lead group
          (&quot;🔒 Lead #N&quot;) containing the rep number; the rep&apos;s
          replies in that group go back to the lead. The rep never sees the
          lead&apos;s number. Config changes take up to 30s to apply.
        </p>
      </div>

      <form onSubmit={create} className="card flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label className="label">Session</label>
          <select
            className="input"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            required
          >
            <option value="">Select a session…</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.organization} — {s.label}
                {s.phoneNumber ? ` (+${s.phoneNumber})` : ""} · {s.status}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-52">
          <label className="label">Rep phone (digits, no +)</label>
          <input
            className="input"
            placeholder="5491155551234"
            inputMode="tel"
            value={repNumber}
            onChange={(e) => setRepNumber(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          Create mirror link
        </button>
      </form>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      ) : links.length === 0 ? (
        <div className="card text-sm text-[var(--color-muted)]">
          No mirror links yet.
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase text-[var(--color-muted)]">
                <th className="px-4 py-3 font-medium">Session</th>
                <th className="px-4 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 font-medium">Rep number</th>
                <th className="px-4 py-3 font-medium">Leads</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="px-4 py-3">
                    <div>{l.session.label}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                      {l.session.phoneNumber && `+${l.session.phoneNumber}`}
                      <StatusBadge status={l.session.status} />
                    </div>
                  </td>
                  <td className="px-4 py-3">{l.organization}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    +{l.repNumber}
                  </td>
                  <td className="px-4 py-3">{l.threads}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggle(l)}
                      disabled={busy}
                      className={`badge ${
                        l.enabled
                          ? "bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
                          : "bg-[var(--color-chip)] text-[var(--color-muted)]"
                      }`}
                    >
                      {l.enabled ? "enabled" : "disabled"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(l.id)}
                      disabled={busy}
                      className="btn-danger text-xs"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
