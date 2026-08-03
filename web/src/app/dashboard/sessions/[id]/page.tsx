"use client";

import { Glyph } from "@/components/glyphs";
import { StatusBadge } from "@/components/status-badge";
import { apiClient } from "@/lib/client-api";
import type { Agent, WaSessionDetail } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export default function SessionDetailPage() {
  const t = useTranslations("dash.sessionDetail");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const router = useRouter();

  const [session, setSession] = useState<WaSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) return;
    apiClient<Agent[]>("/agents", token)
      .then(setAgents)
      .catch(() => setAgents([]));
  }, [token]);

  async function assignAgent(agentId: string) {
    if (!token) return;
    setSession((s) => (s ? { ...s, agentId: agentId || null } : s));
    await apiClient(`/agents/sessions/${id}`, token, {
      method: "POST",
      body: JSON.stringify({ agentId: agentId || null }),
    }).catch((e) =>
      setError(e instanceof Error ? e.message : t("failedToAssign")),
    );
  }

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiClient<WaSessionDetail>(`/sessions/${id}`, token);
      setSession(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    }
  }, [id, token, tc]);

  // Poll while not connected so the QR / status stays fresh.
  useEffect(() => {
    if (!token) return;
    let active = true;
    const tick = async () => {
      await load();
      if (!active) return;
      timer.current = setTimeout(tick, 2500);
    };
    tick();
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [token, load]);

  async function act(path: string, method = "POST") {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/sessions/${id}${path}`, token, { method });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function createShare() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient<{ token: string }>(
        `/sessions/${id}/share`,
        token,
        { method: "POST" },
      );
      setShareUrl(`${window.location.origin}/connect/${res.token}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function revokeShare() {
    if (!token) return;
    setBusy(true);
    try {
      await apiClient(`/sessions/${id}/share`, token, { method: "DELETE" });
      setShareUrl(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveRename(e: React.FormEvent) {
    e.preventDefault();
    if (!token || busy) return;
    const label = labelDraft.trim();
    if (!label) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/sessions/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ label }),
      });
      setRenaming(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!token) return;
    setBusy(true);
    try {
      await apiClient(`/sessions/${id}`, token, { method: "DELETE" });
      router.push("/dashboard/sessions");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("deleteFailed"));
      setBusy(false);
    }
  }

  async function sendTest(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSendResult(null);
    setError(null);
    try {
      await apiClient(`/sessions/${id}/test-message`, token, {
        method: "POST",
        body: JSON.stringify({ to, text }),
      });
      setSendResult(t("messageSent"));
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sendFailed"));
    }
  }

  if (!session) {
    return <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>;
  }

  const isQr = session.status === "QR" && session.qrDataUrl;
  const isConnected = session.status === "CONNECTED";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => router.push("/dashboard/sessions")}
            className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            <Glyph name="chevronLeft" size={14} />
            {t("back")}
          </button>
          {renaming ? (
            <form
              onSubmit={saveRename}
              className="flex items-center gap-2"
            >
              <input
                className="input h-10 w-64 text-lg font-bold"
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                maxLength={80}
                autoFocus
                required
              />
              <button type="submit" className="btn-primary text-xs" disabled={busy}>
                {tc("save")}
              </button>
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="btn-ghost text-xs"
              >
                {tc("cancel")}
              </button>
            </form>
          ) : (
            <h1 className="group flex items-center gap-2 text-2xl font-bold">
              {session.label}
              <button
                onClick={() => {
                  setLabelDraft(session.label);
                  setRenaming(true);
                }}
                className="text-sm text-[var(--color-muted)] opacity-60 hover:text-[var(--color-fg)] hover:opacity-100"
                aria-label={t("rename")}
                title={t("rename")}
              >
                ✎
              </button>
            </h1>
          )}
          <div className="mt-2 flex items-center gap-3">
            <StatusBadge status={session.status} />
            {session.phoneNumber && (
              <span className="text-sm text-[var(--color-muted)]">
                +{session.phoneNumber}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {(session.status === "DISCONNECTED" ||
            session.status === "LOGGED_OUT" ||
            session.status === "PENDING") && (
            <button
              onClick={() => act("/connect")}
              className="btn-ghost"
              disabled={busy}
            >
              {t("reconnect")}
            </button>
          )}
          {isConnected && (
            <button
              onClick={() => act("/logout")}
              className="btn-ghost"
              disabled={busy}
            >
              {t("logOut")}
            </button>
          )}
          <button onClick={remove} className="btn-danger" disabled={busy}>
            {tc("delete")}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      <div className="card">
        <h2 className="mb-1 font-semibold">{t("aiAgent")}</h2>
        <p className="mb-3 text-sm text-[var(--color-muted)]">
          {t("aiAgentHint")}
        </p>
        <select
          className="input max-w-sm"
          value={session.agentId ?? ""}
          onChange={(e) => assignAgent(e.target.value)}
        >
          <option value="">{t("noAgent")}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.enabled ? "" : t("disabledSuffix")}
            </option>
          ))}
        </select>
        {session.agentId &&
          agents.find((a) => a.id === session.agentId)?.enabled === false && (
            <p className="mt-2 text-xs text-[var(--color-warning)]">
              {t("agentDisabledWarning")}
            </p>
          )}
      </div>

      {isQr && (
        <div className="card flex flex-col items-center gap-4 text-center">
          <h2 className="font-semibold">{t("scanToConnect")}</h2>
          <p className="max-w-sm text-sm text-[var(--color-muted)]">
            {t.rich("scanInstructions", { b: (c) => <b>{c}</b> })}
          </p>
          <div className="rounded-xl bg-white p-3">
            <Image
              src={session.qrDataUrl!}
              alt={t("qrAlt")}
              width={280}
              height={280}
              unoptimized
            />
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            {t("qrRefreshes")}
          </p>
        </div>
      )}

      {(session.status === "CONNECTING" || session.status === "PENDING") &&
        !isQr && (
          <div className="card text-center text-sm text-[var(--color-muted)]">
            {t("establishing")}
          </div>
        )}

      {!isConnected && (
        <div className="card">
          <h2 className="mb-1 font-semibold">{t("shareTitle")}</h2>
          <p className="mb-3 text-sm text-[var(--color-muted)]">
            {t("shareHint")}
          </p>
          {shareUrl ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-[var(--color-surface-2)] px-3 py-2 font-mono text-xs">
                  {shareUrl}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(shareUrl);
                    setShareCopied(true);
                    setTimeout(() => setShareCopied(false), 2000);
                  }}
                  className="btn-primary text-xs"
                >
                  {shareCopied ? t("shareCopied") : t("shareCopy")}
                </button>
                <button onClick={revokeShare} className="btn-ghost text-xs">
                  {t("shareRevoke")}
                </button>
              </div>
              <p className="text-xs text-[var(--color-muted)]">
                {t("shareExpires")}
              </p>
            </div>
          ) : (
            <button
              onClick={createShare}
              disabled={busy}
              className="btn-ghost self-start"
            >
              {t("shareCreate")}
            </button>
          )}
        </div>
      )}

      {isConnected && (
        <div className="card">
          <h2 className="mb-1 font-semibold">{t("sendTest")}</h2>
          <p className="mb-2 text-sm text-[var(--color-muted)]">
            {t("sendTestHint")}
          </p>
          <p className="mb-4 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning)]">
            ⚠ {t("coldSendWarning")}
          </p>
          <form onSubmit={sendTest} className="flex flex-col gap-3">
            <input
              className="input"
              placeholder={t("recipientPlaceholder")}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
            <textarea
              className="input min-h-20"
              placeholder={t("messagePlaceholder")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
            />
            <div className="flex items-center gap-3">
              <button type="submit" className="btn-primary">
                {t("send")}
              </button>
              {sendResult && (
                <span className="text-sm text-[var(--color-brand)]">
                  {sendResult}
                </span>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
