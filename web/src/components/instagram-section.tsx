"use client";

import { StatusBadge } from "@/components/status-badge";
import { apiClient } from "@/lib/client-api";
import type { Subscription, WaSession } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * Instagram accounts on the Sessions page.
 *
 * Buying and connecting are one action: a customer who clicks "add an account"
 * wants an account, not a trip to Billing. When no paid seat is free the
 * confirm step states the charge before it happens, because `always_invoice`
 * means the card is charged immediately rather than at the next renewal.
 *
 * The seat is never granted here — `/billing/instagram-seats` charges, Stripe's
 * webhook writes the entitlement, and the connect call re-checks it. So a
 * declined card fails at the charge and simply never reaches OAuth.
 */
export function InstagramSection({
  sessions,
  sub,
  token,
  onChanged,
}: {
  sessions: WaSession[];
  sub: Subscription | null;
  token?: string;
  onChanged: () => void;
}) {
  const t = useTranslations("dash.sessions.instagram");
  const tc = useTranslations("common");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accounts = sessions.filter((s) => s.channel === "INSTAGRAM");
  // null = unlimited (comped orgs). Distinguish it from 0, which means "buy
  // one first" — conflating them would offer a sponsored org a purchase that
  // has no subscription to attach to.
  const seats = sub ? sub.instagram.seats : 0;
  const unlimited = sub != null && seats === null;
  const price = sub?.instagram.monthlyUsd ?? 8.99;
  const hasFreeSeat = unlimited || accounts.length < (seats ?? 0);

  /** Buy a seat if needed, then hand off to Instagram's OAuth. */
  const add = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      // Unlimited orgs never reach here (hasFreeSeat is always true), so a
      // null seat count cannot turn into a purchase.
      if (!hasFreeSeat) {
        await apiClient("/billing/instagram-seats", token, {
          method: "POST",
          body: JSON.stringify({ quantity: (seats ?? 0) + 1 }),
        });
      }
      const { authUrl } = await apiClient<{ authUrl: string }>(
        "/instagram/connect",
        token,
        { method: "POST", body: JSON.stringify({}) },
      );
      window.location.href = authUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
      setBusy(false);
      setConfirming(false);
    }
  };

  const disconnect = async (id: string) => {
    if (!token) return;
    setBusy(true);
    try {
      await apiClient(`/instagram/${id}`, token, { method: "DELETE" });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">{t("title")}</h2>
          <p className="text-sm text-[var(--color-muted)]">
            {unlimited
              ? t("seatsUnlimited", { used: accounts.length })
              : seats && seats > 0
                ? t("seatsUsed", { used: accounts.length, total: seats })
                : t("subtitle")}
          </p>
        </div>
        <button
          className="btn-primary"
          disabled={busy || !sub?.subscribed}
          onClick={() => (hasFreeSeat ? add() : setConfirming(true))}
        >
          {hasFreeSeat ? t("connect") : t("addPaid")}
        </button>
      </div>

      {!sub?.subscribed && (
        <p className="text-sm text-[var(--color-muted)]">{t("needsPlan")}</p>
      )}
      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      {accounts.length === 0 ? (
        <div className="card text-center text-sm text-[var(--color-muted)]">
          {t("none")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {accounts.map((a) => (
            <div key={a.id} className="card flex items-center justify-between">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {a.handle ? `@${a.handle}` : a.label}
                </div>
                <div className="text-sm text-[var(--color-muted)]">
                  {a.status === "CONNECTING" ? t("pending") : t("instagram")}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={a.status} />
                <button
                  className="btn-ghost text-sm"
                  disabled={busy}
                  onClick={() => disconnect(a.id)}
                >
                  {t("disconnect")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card flex max-w-md flex-col gap-4">
            <h3 className="font-semibold">{t("confirmTitle")}</h3>
            {/* Says the money part plainly: charged now, and reducing later
                credits rather than refunds. */}
            <p className="text-sm text-[var(--color-muted)]">
              {t("confirmBody", { price })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                {tc("cancel")}
              </button>
              <button className="btn-primary" disabled={busy} onClick={add}>
                {busy ? tc("loading") : t("confirmCta")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
