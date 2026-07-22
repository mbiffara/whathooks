"use client";

import { GoogleAnalytics } from "@/components/google-analytics";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/logo";
import { apiClient } from "@/lib/client-api";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function ResetPasswordForm() {
  const t = useTranslations("auth");
  const params = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div className="card text-center text-sm text-[var(--color-muted)]">
        <GoogleAnalytics />
        {t("resetLinkMissing")}{" "}
        <Link href="/forgot-password" className="text-[var(--color-brand)]">
          {t("requestNewOne")}
        </Link>
        .
      </div>
    );
  }

  if (done) {
    return (
      <div className="card text-center text-sm text-[var(--color-muted)]">
        {t("passwordUpdated")}{" "}
        <Link href="/signin" className="text-[var(--color-brand)]">
          {t("signIn")}
        </Link>{" "}
        {t("signInWithNew")}
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("passwordsDontMatch"));
      return;
    }
    setLoading(true);
    try {
      await apiClient("/auth/reset-password", undefined, {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("somethingWentWrong"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-4">
      <div>
        <label className="label">{t("newPassword")}</label>
        <input
          type="password"
          required
          minLength={8}
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("passwordPlaceholder")}
        />
      </div>
      <div>
        <label className="label">{t("confirmNewPassword")}</label>
        <input
          type="password"
          required
          minLength={8}
          className="input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
        />
      </div>
      {error && (
        <p className="text-sm text-red-400">
          {error}{" "}
          {/expired|invalid/i.test(error) && (
            <Link href="/forgot-password" className="text-[var(--color-brand)]">
              {t("requestNewLink")}
            </Link>
          )}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? t("updating") : t("updatePassword")}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  const t = useTranslations("auth");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <h1 className="mb-6 text-center text-2xl font-bold">
          {t("chooseNewPassword")}
        </h1>
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
