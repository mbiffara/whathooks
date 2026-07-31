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
  repName: string | null;
  createdAt: string;
  threads: number;
  session: Omit<MirrorSession, "organization">;
  organization: string;
}

interface SalesRep {
  id: string;
  name: string;
  phoneNumber: string;
  links: number;
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
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [repId, setRepId] = useState("");
  const [repName, setRepName] = useState("");
  const [repPhone, setRepPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [data, repList] = await Promise.all([
        apiClient<{ links: MirrorLink[]; sessions: MirrorSession[] }>(
          "/admin/mirror-links",
          token,
        ),
        apiClient<SalesRep[]>("/admin/sales-reps", token),
      ]);
      setLinks(data.links);
      setSessions(data.sessions);
      setReps(repList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function addRep(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      await apiClient("/admin/sales-reps", token, {
        method: "POST",
        body: JSON.stringify({
          name: repName.trim(),
          phoneNumber: repPhone.trim(),
        }),
      });
      setRepName("");
      setRepPhone("");
    });
  }

  function createLink(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      await apiClient("/admin/mirror-links", token, {
        method: "POST",
        body: JSON.stringify({ sessionId, repId }),
      });
      setSessionId("");
      setRepId("");
    });
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
          (&quot;🔒 Lead #N&quot;) containing the rep; the rep&apos;s replies
          in that group go back to the lead. The rep never sees the
          lead&apos;s number. Config changes take up to 30s to apply.
        </p>
      </div>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">Sales reps</h2>
        {reps.length > 0 && (
          <ul className="flex flex-col gap-1">
            {reps.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm"
              >
                <span className="font-medium">{r.name}</span>
                <span className="font-mono text-xs text-[var(--color-muted)]">
                  +{r.phoneNumber}
                </span>
                {r.links > 0 && (
                  <span className="badge bg-[var(--color-chip)] text-[var(--color-muted)] text-[10px]">
                    {r.links} link{r.links === 1 ? "" : "s"}
                  </span>
                )}
                <button
                  onClick={() =>
                    void run(() =>
                      apiClient(`/admin/sales-reps/${r.id}`, token, {
                        method: "DELETE",
                      }),
                    )
                  }
                  disabled={busy}
                  className="ml-auto text-xs text-[var(--color-muted)] hover:text-[var(--color-danger)]"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addRep} className="flex flex-wrap items-end gap-3">
          <div className="min-w-44">
            <label className="label">Name</label>
            <input
              className="input"
              placeholder="Juan Pérez"
              value={repName}
              onChange={(e) => setRepName(e.target.value)}
              required
            />
          </div>
          <div className="min-w-52">
            <label className="label">Phone (digits, no +)</label>
            <input
              className="input"
              placeholder="5491155551234"
              inputMode="tel"
              value={repPhone}
              onChange={(e) => setRepPhone(e.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={busy} className="btn-ghost">
            + Add rep
          </button>
        </form>
      </section>

      <form onSubmit={createLink} className="card flex flex-wrap items-end gap-3">
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
        <div className="min-w-56">
          <label className="label">Sales rep</label>
          <select
            className="input"
            value={repId}
            onChange={(e) => setRepId(e.target.value)}
            required
          >
            <option value="">Select a rep…</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (+{r.phoneNumber})
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          Create mirror link
        </button>
        {reps.length === 0 && (
          <p className="w-full text-xs text-[var(--color-muted)]">
            Add a sales rep above first.
          </p>
        )}
      </form>

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
                <th className="px-4 py-3 font-medium">Rep</th>
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
                  <td className="px-4 py-3">
                    <div>{l.repName ?? "—"}</div>
                    <div className="font-mono text-xs text-[var(--color-muted)]">
                      +{l.repNumber}
                    </div>
                  </td>
                  <td className="px-4 py-3">{l.threads}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        void run(() =>
                          apiClient(`/admin/mirror-links/${l.id}`, token, {
                            method: "PATCH",
                            body: JSON.stringify({ enabled: !l.enabled }),
                          }),
                        )
                      }
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
                      onClick={() =>
                        void run(() =>
                          apiClient(`/admin/mirror-links/${l.id}`, token, {
                            method: "DELETE",
                          }),
                        )
                      }
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
