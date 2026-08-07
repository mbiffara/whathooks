"use client";

import { apiClient, isSubscriptionRequired } from "@/lib/client-api";
import type { WaSession } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Create a WhatsApp session and go straight to its QR. Shared by the
 * overview's "Connect a number" and the sessions page, so both entry points
 * ask for the same thing and land in the same place.
 */
export function NewSessionDialog({
  open,
  onClose,
  token,
  needsPlan = false,
  onSubscriptionRequired,
}: {
  open: boolean;
  onClose: () => void;
  token?: string;
  /** Known-unsubscribed: offer the upgrade without a round-trip to a 403. */
  needsPlan?: boolean;
  onSubscriptionRequired: () => void;
}) {
  const t = useTranslations("dash.sessions");
  const tc = useTranslations("common");
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (needsPlan) {
      onSubscriptionRequired();
      onClose();
      return;
    }
    if (!token || !label.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await apiClient<WaSession>("/sessions", token, {
        method: "POST",
        body: JSON.stringify({ label: label.trim() }),
      });
      router.push(`/dashboard/sessions/${created.id}`);
    } catch (err) {
      if (isSubscriptionRequired(err)) {
        onSubscriptionRequired();
        onClose();
      } else {
        setError(err instanceof Error ? err.message : tc("failedToCreate"));
      }
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-session-title"
    >
      <form
        className="card w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
        onSubmit={create}
      >
        <h2 id="new-session-title" className="text-lg font-semibold">
          {t("newSessionTitle")}
        </h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {t("newSessionHint")}
        </p>
        <div className="mt-4">
          <label className="label" htmlFor="new-session-label">
            {t("newSessionLabel")}
          </label>
          <input
            id="new-session-label"
            className="input"
            placeholder={t("labelPlaceholder")}
            autoFocus
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        {error && (
          <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
        )}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {tc("cancel")}
          </button>
          <button
            type="submit"
            className="btn-primary"
            // Stays clickable without a plan so the click can explain why.
            disabled={creating || (!needsPlan && !label.trim())}
          >
            {creating ? t("creating") : t("createConnect")}
          </button>
        </div>
      </form>
    </div>
  );
}
