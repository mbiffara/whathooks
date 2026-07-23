"use client";

import { apiClient } from "@/lib/client-api";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Admin action: send the founder welcome email to a user, picking the
 * language in a small modal. Internal tool — English-only UI.
 */
export function AdminWelcomeEmail({
  userId,
  email,
  defaultLocale,
  sentAt,
}: {
  userId: string;
  email: string;
  defaultLocale: string;
  /** When set, the welcome email was already sent (duplicate guard). */
  sentAt?: string | null;
}) {
  const { data: session } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [locale, setLocale] = useState(defaultLocale === "es" ? "es" : "en");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send() {
    const token = session?.accessToken;
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient<{ sent: boolean }>(
        `/admin/users/${userId}/welcome-email`,
        token,
        { method: "POST", body: JSON.stringify({ locale }) },
      );
      setResult(res.sent ? "Sent ✓" : "Mailer not configured — nothing sent");
      if (res.sent) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setResult(null);
          setError(null);
          setOpen(true);
        }}
        className={`btn-ghost px-2 py-1 text-xs ${
          sentAt ? "text-[var(--color-muted)]" : ""
        }`}
        title={
          sentAt ? `Sent ${new Date(sentAt).toLocaleDateString()}` : undefined
        }
      >
        {sentAt ? "Welcome sent ✓" : "Welcome email"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Send welcome email</h2>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              A personal note from Marcelo to{" "}
              <span className="font-medium text-[var(--color-fg)]">
                {email}
              </span>
              , asking what they plan to use whathooks for and offering help.
              Replies go to marcelo@logicalminds.co.
            </p>
            {sentAt && (
              <p className="mt-3 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning)]">
                Already sent on {new Date(sentAt).toLocaleString()} — sending
                again will deliver a duplicate.
              </p>
            )}
            <div className="mt-4">
              <label className="label">Language</label>
              <select
                className="input"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                disabled={busy}
              >
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </div>
            {error && (
              <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
            )}
            {result && (
              <p className="mt-3 text-sm text-[var(--color-brand)]">{result}</p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setOpen(false)} className="btn-ghost">
                {result ? "Close" : "Cancel"}
              </button>
              {!result && (
                <button onClick={send} disabled={busy} className="btn-primary">
                  {busy ? "Sending…" : "Send"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
