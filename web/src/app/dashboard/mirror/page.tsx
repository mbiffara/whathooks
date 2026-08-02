"use client";

import { StatusBadge } from "@/components/status-badge";
import { apiClient } from "@/lib/client-api";
import type { WaSession, WaStatus } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

interface MirrorLink {
  id: string;
  enabled: boolean;
  repNumber: string;
  repId: string | null;
  repName: string | null;
  threads: number;
  session: {
    id: string;
    label: string;
    phoneNumber: string | null;
    status: WaStatus;
  };
  createdAt: string;
}

interface SalesRep {
  id: string;
  name: string;
  phoneNumber: string;
  links: number;
}

/** Mirror Link: relay DMs into per-lead groups with a rep (number hidden). */
export default function MirrorPage() {
  const t = useTranslations("dash.mirror");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [links, setLinks] = useState<MirrorLink[]>([]);
  const [sessions, setSessions] = useState<WaSession[]>([]);
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
      const [linkList, sessionList, repList] = await Promise.all([
        apiClient<MirrorLink[]>("/mirror-links", token),
        apiClient<WaSession[]>("/sessions", token),
        apiClient<SalesRep[]>("/sales-reps", token),
      ]);
      setLinks(linkList);
      setSessions(sessionList);
      setReps(repList);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [token, tc]);

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
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  function addRep(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      await apiClient("/sales-reps", token, {
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
      await apiClient("/mirror-links", token, {
        method: "POST",
        body: JSON.stringify({ sessionId, repId }),
      });
      setSessionId("");
      setRepId("");
    });
  }

  // Sessions that don't already have a mirror link.
  const availableSessions = sessions.filter(
    (s) => !links.some((l) => l.session.id === s.id),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {t("subtitle")}
        </p>
      </div>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">{t("repsTitle")}</h2>
        <p className="text-xs text-[var(--color-muted)]">{t("repsHint")}</p>
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
                    {t("repInUse", { count: r.links })}
                  </span>
                )}
                <button
                  onClick={() =>
                    void run(() =>
                      apiClient(`/sales-reps/${r.id}`, token, {
                        method: "DELETE",
                      }),
                    )
                  }
                  disabled={busy}
                  className="ml-auto text-xs text-[var(--color-muted)] hover:text-[var(--color-danger)]"
                >
                  {tc("delete")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addRep} className="flex flex-wrap items-end gap-3">
          <div className="min-w-44">
            <label className="label">{t("repName")}</label>
            <input
              className="input"
              placeholder="Juan Pérez"
              value={repName}
              onChange={(e) => setRepName(e.target.value)}
              required
            />
          </div>
          <div className="min-w-52">
            <label className="label">{t("repPhone")}</label>
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
            + {t("addRep")}
          </button>
        </form>
      </section>

      <form
        onSubmit={createLink}
        className="card flex flex-wrap items-end gap-3"
      >
        <div className="min-w-64 flex-1">
          <label className="label">{t("sessionLabel")}</label>
          <select
            className="input"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            required
          >
            <option value="">{t("selectSession")}</option>
            {availableSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.phoneNumber ? ` (+${s.phoneNumber})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-56">
          <label className="label">{t("repLabel")}</label>
          <select
            className="input"
            value={repId}
            onChange={(e) => setRepId(e.target.value)}
            required
          >
            <option value="">{t("selectRep")}</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (+{r.phoneNumber})
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          {t("createLink")}
        </button>
        {reps.length === 0 && (
          <p className="w-full text-xs text-[var(--color-muted)]">
            {t("addRepFirst")}
          </p>
        )}
      </form>

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
      ) : links.length === 0 ? (
        <div className="card text-sm text-[var(--color-muted)]">
          {t("noLinks")}
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase text-[var(--color-muted)]">
                <th className="px-4 py-3 font-medium">{t("colSession")}</th>
                <th className="px-4 py-3 font-medium">{t("colRep")}</th>
                <th className="px-4 py-3 font-medium">{t("colLeads")}</th>
                <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
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
                          apiClient(`/mirror-links/${l.id}`, token, {
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
                      {l.enabled ? tc("enabled") : tc("disabled")}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() =>
                        void run(() =>
                          apiClient(`/mirror-links/${l.id}`, token, {
                            method: "DELETE",
                          }),
                        )
                      }
                      disabled={busy}
                      className="btn-danger text-xs"
                    >
                      {tc("delete")}
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
