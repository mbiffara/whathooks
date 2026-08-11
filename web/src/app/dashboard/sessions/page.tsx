"use client";

import { InstagramSection } from "@/components/instagram-section";
import { NewSessionDialog } from "@/components/new-session-dialog";
import { StatusBadge } from "@/components/status-badge";
import { UpgradeModal } from "@/components/upgrade-modal";
import { apiClient } from "@/lib/client-api";
import type { Subscription, WaSession } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function SessionsPage() {
  const t = useTranslations("dash.sessions");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const params = useSearchParams();
  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
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
      .then((s) => {
        setSub(s);
        setNeedsPlan(!s.subscribed);
      })
      .catch(() => {});
  }, [token, tc]);

  useEffect(() => {
    load();
  }, [load]);

  // Returning from Instagram's OAuth. Zernio's callback lands on Zernio, not
  // on us, so nothing of ours observes the completion — reconcile matches the
  // newly authorised account onto the session that was waiting for it.
  const returned = params.get("instagram");
  useEffect(() => {
    if (!returned || !token) return;
    apiClient("/instagram/reconcile", token, { method: "POST" })
      .then(() => load())
      .catch(() => load());
  }, [returned, token, load]);

  const whatsapp = sessions.filter((s) => s.channel !== "INSTAGRAM");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-[var(--color-muted)]">{t("subtitle")}</p>
      </div>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      <NewSessionDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        token={token}
        needsPlan={needsPlan}
        onSubscriptionRequired={() => setShowUpgrade(true)}
      />

      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        action={t("upgradeAction")}
      />

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">{t("whatsapp.title")}</h2>
                <p className="text-sm text-[var(--color-muted)]">
                  {t("whatsapp.subtitle")}
                </p>
              </div>
              <button
                className="btn-primary"
                // Same gate as the overview: no plan, no name prompt first.
                onClick={() =>
                  needsPlan ? setShowUpgrade(true) : setNewOpen(true)
                }
              >
                {t("newSessionTitle")}
              </button>
            </div>

            {whatsapp.length === 0 ? (
              <div className="card text-center text-sm text-[var(--color-muted)]">
                {t("noSessions")}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {whatsapp.map((s) => (
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
          </section>

          <InstagramSection
            sessions={sessions}
            sub={sub}
            token={token}
            onChanged={load}
          />
        </>
      )}
    </div>
  );
}
