"use client";

import { StatusBadge } from "@/components/status-badge";
import { UpgradeModal } from "@/components/upgrade-modal";
import { apiClient, isSubscriptionRequired } from "@/lib/client-api";
import type { Subscription, WaSession } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function SessionsPage() {
  const t = useTranslations("dash.sessions");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const router = useRouter();
  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  // Known-unsubscribed orgs get the upgrade modal on click instead of a
  // round-trip to the API's 403 (which stays as the fallback).
  const [needsPlan, setNeedsPlan] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiClient<WaSession[]>("/sessions", token);
      setSessions(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    } finally {
      setLoading(false);
    }
    // Best-effort; if it fails we just fall back to the API 403 path.
    apiClient<Subscription>("/billing/subscription", token)
      .then((sub) => setNeedsPlan(!sub.subscribed))
      .catch(() => {});
  }, [token, tc]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (needsPlan) {
      setShowUpgrade(true);
      return;
    }
    if (!token || !label.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await apiClient<WaSession>("/sessions", token, {
        method: "POST",
        body: JSON.stringify({ label: label.trim() }),
      });
      router.push(`/dashboard/sessions/${created.id}`);
    } catch (e) {
      if (isSubscriptionRequired(e)) {
        setShowUpgrade(true);
      } else {
        setError(e instanceof Error ? e.message : tc("failedToCreate"));
      }
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-[var(--color-muted)]">{t("subtitle")}</p>
      </div>

      <form
        onSubmit={create}
        className="card flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <label className="label">{t("newSessionLabel")}</label>
          <input
            className="input"
            placeholder={t("labelPlaceholder")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="btn-primary"
          // When a plan is needed, stay clickable so the click can explain
          // why (upgrade modal) instead of presenting a dead button.
          disabled={creating || (!needsPlan && !label.trim())}
        >
          {creating ? t("creating") : t("createConnect")}
        </button>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        action={t("upgradeAction")}
      />

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
      ) : sessions.length === 0 ? (
        <div className="card text-center text-sm text-[var(--color-muted)]">
          {t("noSessions")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/dashboard/sessions/${s.id}`}
              className="card flex items-center justify-between hover:border-[var(--color-brand)]/50"
            >
              <div>
                <div className="font-medium">{s.label}</div>
                <div className="text-sm text-[var(--color-muted)]">
                  {s.phoneNumber ? `+${s.phoneNumber}` : t("notLinked")}
                </div>
              </div>
              <StatusBadge status={s.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
