"use client";

import { StatusBadge } from "@/components/status-badge";
import { apiClient } from "@/lib/client-api";
import type { WaSession, WaStatus } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface MirrorLink {
  id: string;
  enabled: boolean;
  agentNumber: string;
  humanAgentId: string | null;
  humanAgentName: string | null;
  groupPrefix: string;
  threads: number;
  session: {
    id: string;
    label: string;
    phoneNumber: string | null;
    status: WaStatus;
  };
  createdAt: string;
}

interface HumanAgent {
  id: string;
  name: string;
  phoneNumber: string;
}

/** Mirror Link: relay DMs into per-lead groups with a human agent. */
export default function MirrorPage() {
  const t = useTranslations("dash.mirror");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [links, setLinks] = useState<MirrorLink[]>([]);
  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [agents, setAgents] = useState<HumanAgent[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [humanAgentId, setHumanAgentId] = useState("");
  const [groupPrefix, setGroupPrefix] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [linkList, sessionList, agentList] = await Promise.all([
        apiClient<MirrorLink[]>("/mirror-links", token),
        apiClient<WaSession[]>("/sessions", token),
        apiClient<HumanAgent[]>("/human-agents", token),
      ]);
      setLinks(linkList);
      setSessions(sessionList);
      setAgents(agentList);
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

  function createLink(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      await apiClient("/mirror-links", token, {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          humanAgentId,
          ...(groupPrefix.trim() ? { groupPrefix: groupPrefix.trim() } : {}),
        }),
      });
      setSessionId("");
      setHumanAgentId("");
      setGroupPrefix("");
    });
  }

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

      <form
        onSubmit={createLink}
        className="card flex flex-wrap items-end gap-3"
      >
        <div className="min-w-60 flex-1">
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
        <div className="min-w-52">
          <label className="label">{t("agentLabel")}</label>
          <select
            className="input"
            value={humanAgentId}
            onChange={(e) => setHumanAgentId(e.target.value)}
            required
          >
            <option value="">{t("selectAgent")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} (+{a.phoneNumber})
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-44">
          <label className="label">{t("prefixLabel")}</label>
          <input
            className="input"
            placeholder="🔒 Lead"
            maxLength={40}
            value={groupPrefix}
            onChange={(e) => setGroupPrefix(e.target.value)}
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          {t("createLink")}
        </button>
        <p className="w-full text-xs text-[var(--color-muted)]">
          {t("prefixHint")}{" "}
          {agents.length === 0 && (
            <Link
              href="/dashboard/human-agents"
              className="text-[var(--color-brand)] hover:underline"
            >
              {t("addAgentFirst")}
            </Link>
          )}
        </p>
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
                <th className="px-4 py-3 font-medium">{t("colAgent")}</th>
                <th className="px-4 py-3 font-medium">{t("colPrefix")}</th>
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
                    <div>{l.humanAgentName ?? "—"}</div>
                    <div className="font-mono text-xs text-[var(--color-muted)]">
                      +{l.agentNumber}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">{l.groupPrefix} #N</td>
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
