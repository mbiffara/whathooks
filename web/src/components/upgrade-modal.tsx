"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Shown when the API rejects an action with "subscription required"
 * (see isSubscriptionRequired in client-api). Points the user at Billing.
 */
export function UpgradeModal({
  open,
  onClose,
  action = "This action",
}: {
  open: boolean;
  onClose: () => void;
  /** What the user tried to do, e.g. "Connecting a WhatsApp number". */
  action?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-modal-title"
    >
      <div
        className="card w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="upgrade-modal-title" className="text-lg font-semibold">
          Paid plan required
        </h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {action} requires an active subscription. Pick a plan to continue —
          you can cancel anytime.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="btn-ghost">
            Not now
          </button>
          <Link href="/dashboard/billing" className="btn-primary">
            View plans
          </Link>
        </div>
      </div>
    </div>
  );
}
