"use client";

import { apiClient } from "@/lib/client-api";
import type { Subscription } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useState } from "react";

/**
 * Instagram seats on the Billing page.
 *
 * Seats, not connected accounts, are what the subscription charges for: a seat
 * stays paid when its account is disconnected, so this is the only place the
 * bill can actually be reduced. Without it a customer could start paying from
 * the Sessions page and have no way to stop.
 *
 * Reducing is refused server-side below the number of connected accounts, so
 * the copy tells people to disconnect first rather than letting the request
 * fail with something unhelpful.
 */
export function InstagramSeatsCard({
  sub,
  isOwner,
  onChanged,
}: {
  sub: Subscription | null;
  isOwner: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("dash.billing.instagram");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Comped orgs have no subscription item to attach seats to.
  if (!sub || sub.instagram.seats === null) return null;

  const seats = sub.instagram.seats;
  const connected = sub.instagram.connected;
  const price = sub.instagram.monthlyUsd;

  const setSeats = async (quantity: number) => {
    if (!token || quantity < 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient("/billing/instagram-seats", token, {
        method: "POST",
        body: JSON.stringify({ quantity }),
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t("title")}</h3>
          <p className="text-sm text-[var(--color-muted)]">
            {seats === 0
              ? t("none")
              : t("summary", {
                  seats,
                  connected,
                  total: (seats * price).toFixed(2),
                })}
          </p>
        </div>
        {isOwner && (
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost h-9 w-9 p-0 text-lg leading-none"
              // Disabled at the floor rather than letting the server refuse:
              // the seat cannot go below what is connected.
              disabled={busy || seats <= connected}
              title={seats <= connected ? t("disconnectFirst") : undefined}
              onClick={() => setSeats(seats - 1)}
            >
              −
            </button>
            <span className="min-w-8 text-center font-semibold tabular-nums">
              {seats}
            </span>
            <button
              className="btn-ghost h-9 w-9 p-0 text-lg leading-none"
              disabled={busy}
              onClick={() => setSeats(seats + 1)}
            >
              +
            </button>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-[var(--color-muted)]">
        {t("proration", { price: price.toFixed(2) })}
      </p>
      {seats > connected && (
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          {t("unused", { n: seats - connected })}
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm text-[var(--color-danger)]">{error}</p>
      )}
    </div>
  );
}
