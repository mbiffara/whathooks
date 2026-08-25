"use client";

import { apiClient } from "@/lib/client-api";
import type { Subscription } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

/**
 * Banner for a subscription whose last charge was declined.
 *
 * `past_due` keeps full access while Stripe retries the card, so without
 * this nothing in the app told the customer anything was wrong: the only
 * signal was the billing page status line, which still read "renews on…".
 * Renders nothing for every other status, so paying orgs never see it.
 * Only the owner can open the portal; members are told who to ask.
 */
export function PaymentDueAlert() {
  const t = useTranslations("dash.billing");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const isOwner = auth?.user?.orgRole === "OWNER";
  const [sub, setSub] = useState<Subscription | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiClient<Subscription>("/billing/subscription", token)
      .then(setSub)
      .catch(() => undefined);
  }, [token]);

  async function openPortal() {
    if (!token) return;
    setBusy(true);
    try {
      const { url } = await apiClient<{ url: string }>(
        "/billing/portal",
        token,
        { method: "POST" },
      );
      window.location.href = url;
    } catch {
      setBusy(false);
    }
  }

  if (sub?.status !== "past_due") return null;

  // Three wordings: sending already paused, paused on a known date, or
  // (no date recorded) just "fix the card".
  const blocked = sub.pastDue?.blocked ?? false;
  const graceEndsAt = sub.pastDue?.graceEndsAt ?? null;
  const date = graceEndsAt ? new Date(graceEndsAt).toLocaleDateString() : "";
  const ownerKey = blocked
    ? "pastDueBodyPaused"
    : graceEndsAt
      ? "pastDueBodyUntil"
      : "pastDueBody";
  const memberKey = blocked ? "pastDueBodyMemberPaused" : "pastDueBodyMember";

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)] px-4 py-3">
      <div>
        <div className="text-sm font-semibold text-[var(--color-warning)]">
          ⚠ {t("pastDueTitle")}
        </div>
        <p className="mt-0.5 text-xs text-[var(--color-warning)]">
          {isOwner
            ? t(ownerKey, { plan: sub.limits.label, date })
            : t(memberKey)}
        </p>
      </div>
      {isOwner && (
        <button
          onClick={openPortal}
          disabled={busy}
          className="btn-primary shrink-0 text-sm disabled:opacity-50"
        >
          {busy ? t("opening") : t("pastDueCta")}
        </button>
      )}
    </div>
  );
}
