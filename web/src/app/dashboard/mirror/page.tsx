"use client";

import { Glyph } from "@/components/glyphs";
import { relativeTime } from "@/components/messages/utils";
import { StatusBadge } from "@/components/status-badge";
import { apiClient } from "@/lib/client-api";
import type { WaSession, WaStatus } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/** One live mirror, whatever opened it: a link, a flow handoff, or the inbox. */
interface MirrorThread {
  id: string;
  seq: number;
  groupJid: string;
  leadJid: string;
  leadNumber: string;
  agents: { number: string; name: string | null }[];
  fromLink: boolean;
  session: {
    id: string;
    label: string;
    phoneNumber: string | null;
    status: WaStatus;
  };
  conversationId: string | null;
  contactName: string | null;
  createdAt: string;
}

interface MirrorLink {
  id: string;
  enabled: boolean;
  agentNumber: string;
  humanAgentId: string | null;
  humanAgentName: string | null;
  groupPrefix: string;
  showLeadName: boolean;
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
  // null = the API has no /mirror-threads endpoint; hide the section.
  const [threads, setThreads] = useState<MirrorThread[] | null>([]);
  const [links, setLinks] = useState<MirrorLink[]>([]);
  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [agents, setAgents] = useState<HumanAgent[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [humanAgentId, setHumanAgentId] = useState("");
  const [groupPrefix, setGroupPrefix] = useState("");
  const [showLeadName, setShowLeadName] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [threadList, linkList, sessionList, agentList] = await Promise.all([
        // Newer than the rest of this page: an API that predates the
        // endpoint must not take the link config down with it. Null hides
        // the section rather than claiming there are no mirrors.
        apiClient<MirrorThread[]>("/mirror-threads", token).catch(() => null),
        apiClient<MirrorLink[]>("/mirror-links", token),
        apiClient<WaSession[]>("/sessions", token),
        apiClient<HumanAgent[]>("/human-agents", token),
      ]);
      setThreads(threadList);
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
          showLeadName,
          ...(groupPrefix.trim() ? { groupPrefix: groupPrefix.trim() } : {}),
        }),
      });
      setSessionId("");
      setHumanAgentId("");
      setGroupPrefix("");
      setShowLeadName(true);
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

      {threads !== null && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("activeTitle")}</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {t("activeSubtitle")}
            </p>
          </div>
          {loading ? (
            <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
          ) : threads.length === 0 ? (
            <div className="card text-sm text-[var(--color-muted)]">
              {t("noThreads")}
            </div>
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase text-[var(--color-muted)]">
                    <th className="px-4 py-3 font-medium">{t("colContact")}</th>
                    <th className="px-4 py-3 font-medium">{t("colSession")}</th>
                    <th className="px-4 py-3 font-medium">{t("colAgents")}</th>
                    <th className="px-4 py-3 font-medium">{t("colGroup")}</th>
                    <th className="px-4 py-3 font-medium">{t("colOpened")}</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {threads.map((th) => (
                    <tr
                      key={th.id}
                      className="border-b border-[var(--color-border)] last:border-0"
                    >
                      <td className="px-4 py-3">
                        {th.conversationId ? (
                          <Link
                            href={`/dashboard/messages?c=${th.conversationId}`}
                            title={t("openConversation")}
                            className="text-[var(--color-brand)] hover:underline"
                          >
                            {th.contactName || `+${th.leadNumber}`}
                          </Link>
                        ) : (
                          <span>{th.contactName || `+${th.leadNumber}`}</span>
                        )}
                        {th.contactName && (
                          <div className="font-mono text-xs text-[var(--color-muted)]">
                            +{th.leadNumber}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div>{th.session.label}</div>
                        <div className="mt-0.5">
                          <StatusBadge status={th.session.status} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {th.agents.map((a) => (
                          <div key={a.number}>
                            <span
                              className={
                                a.name ? "" : "text-[var(--color-muted)] italic"
                              }
                            >
                              {a.name ?? t("unknownAgent")}
                            </span>
                            <span className="ml-1.5 font-mono text-xs text-[var(--color-muted)]">
                              +{a.number}
                            </span>
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-3">
                        <div>#{th.seq}</div>
                        {th.fromLink && (
                          <span
                            className="badge mt-0.5 bg-[var(--color-chip)] text-[var(--color-muted)]"
                            title={t("fromLinkHint")}
                          >
                            {t("title")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-muted)]">
                        {relativeTime(th.createdAt, t("now"))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            if (!confirm(t("confirmRemoveThread"))) return;
                            void run(() =>
                              apiClient(`/mirror-threads/${th.id}`, token, {
                                method: "DELETE",
                              }),
                            );
                          }}
                          disabled={busy}
                          aria-label={t("removeThread")}
                          title={t("removeThread")}
                          className="rounded-lg p-1.5 text-[var(--color-muted)] hover:text-[var(--color-danger)] disabled:opacity-50"
                        >
                          <Glyph name="unlink" size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <div>
        <h2 className="text-lg font-semibold">{t("linksTitle")}</h2>
      </div>

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
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={showLeadName}
            onChange={(e) => setShowLeadName(e.target.checked)}
          />
          {t("showLeadName")}
        </label>
        <button type="submit" disabled={busy} className="btn-primary">
          {t("createLink")}
        </button>
        <p className="w-full text-xs text-[var(--color-muted)]">
          {t("prefixHint")}{" "}
          {agents.length === 0 && (
            <Link
              href="/dashboard/human-agents"
              className="inline-flex items-center gap-0.5 text-[var(--color-brand)] hover:underline"
            >
              {t("addAgentFirst")}
              <Glyph name="chevronRight" size={12} />
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
                  <td className="px-4 py-3 text-xs">
                    <div>{l.groupPrefix} #N</div>
                    <button
                      onClick={() =>
                        void run(() =>
                          apiClient(`/mirror-links/${l.id}`, token, {
                            method: "PATCH",
                            body: JSON.stringify({
                              showLeadName: !l.showLeadName,
                            }),
                          }),
                        )
                      }
                      disabled={busy}
                      className="mt-0.5 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-fg)] underline decoration-dotted"
                    >
                      {l.showLeadName ? t("nameShown") : t("nameHidden")}
                    </button>
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
