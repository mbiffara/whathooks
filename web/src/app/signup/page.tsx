"use client";

import { GoogleAnalytics, gaEvent } from "@/components/google-analytics";
import { readAdClickId } from "@/components/ad-click-tracker";
import { useLocale, useTranslations } from "next-intl";
import { Logo } from "@/components/logo";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/v1";

function SignUpForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const inviteToken = params.get("invite");
  const [form, setForm] = useState({
    name: "",
    email: params.get("email") ?? "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Manual GA event: fires on direct loads AND client-side navigations,
  // independent of the property's Enhanced Measurement setting.
  useEffect(() => {
    gaEvent("signup_page_visited", {
      invited: Boolean(inviteToken),
      locale,
    });
  }, [inviteToken, locale]);

  function set(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // X ads attribution: pass along the click id captured on the landing
      // page, if any (see AdClickTracker).
      const twclid = readAdClickId() || undefined;
      const body = inviteToken
        ? {
            name: form.name,
            email: form.email,
            password: form.password,
            inviteToken,
            twclid,
            locale,
          }
        : { ...form, twclid, locale };
      const res = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const resBody = await res.json().catch(() => ({}));
        throw new Error(
          Array.isArray(resBody.message)
            ? resBody.message.join(", ")
            : (resBody.message ?? t("registrationFailed")),
        );
      }
      // Auto sign-in after registration.
      const signin = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });
      if (signin?.error) throw new Error(t("couldNotSignIn"));
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("somethingWentWrong"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <GoogleAnalytics />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <h1 className="mb-6 text-center text-2xl font-bold">
          {inviteToken ? t("joinYourTeam") : t("createYourAccount")}
        </h1>
        {inviteToken && (
          <p className="mb-4 text-center text-sm text-[var(--color-muted)]">
            {t("acceptInvitationHint")}
          </p>
        )}
        <form onSubmit={onSubmit} className="card flex flex-col gap-4">
          <div>
            <label className="label">{t("yourName")}</label>
            <input
              required
              className="input"
              value={form.name}
              onChange={set("name")}
              placeholder="Jane Doe"
            />
          </div>
          <div>
            <label className="label">{t("email")}</label>
            <input
              type="email"
              required
              className="input"
              value={form.email}
              onChange={set("email")}
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label className="label">{t("password")}</label>
            <input
              type="password"
              required
              minLength={8}
              className="input"
              value={form.password}
              onChange={set("password")}
              placeholder={t("passwordPlaceholder")}
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? t("creating") : t("createAccount")}
          </button>
          <p className="text-center text-sm text-[var(--color-muted)]">
            {t("alreadyHaveAccount")}{" "}
            <Link href="/signin" className="text-[var(--color-brand)]">
              {t("signIn")}
            </Link>
          </p>
          <p className="text-center text-xs text-[var(--color-muted)]">
            {t("agreeTo")}{" "}
            <Link href="/terms" className="hover:underline">
              {t("termsOfService")}
            </Link>{" "}
            {t("and")}{" "}
            <Link href="/privacy" className="hover:underline">
              {t("privacyPolicy")}
            </Link>
            .
          </p>
        </form>
      </div>
    </main>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
