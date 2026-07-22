"use client";

import { GoogleAnalytics } from "@/components/google-analytics";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/logo";
import { apiClient } from "@/lib/client-api";
import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiClient("/auth/forgot-password", undefined, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("somethingWentWrong"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <GoogleAnalytics />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <h1 className="mb-6 text-center text-2xl font-bold">
          {t("resetYourPassword")}
        </h1>
        {sent ? (
          <div className="card text-center text-sm text-[var(--color-muted)]">
            {t.rich("resetSent", {
              email,
              b: (chunks) => <strong>{chunks}</strong>,
            })}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="card flex flex-col gap-4">
            <p className="text-sm text-[var(--color-muted)]">
              {t("resetIntro")}
            </p>
            <div>
              <label className="label">{t("email")}</label>
              <input
                type="email"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? t("sending") : t("sendResetLink")}
            </button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-[var(--color-muted)]">
          <Link href="/signin" className="text-[var(--color-brand)]">
            {t("backToSignIn")}
          </Link>
        </p>
      </div>
    </main>
  );
}
