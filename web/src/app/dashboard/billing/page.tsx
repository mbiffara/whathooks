"use client";

import { apiClient } from "@/lib/client-api";
import {
  PLAN_PRICING,
  type PurchasablePlan,
  type Subscription,
} from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

const PLAN_ORDER: PurchasablePlan[] = ["STARTER", "PRO", "BUSINESS"];

function BillingContent() {
  const t = useTranslations("dash.billing");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const isOwner = auth?.user?.orgRole === "OWNER";
  const params = useSearchParams();
  const checkout = params.get("checkout");

  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setSub(await apiClient<Subscription>("/billing/subscription", token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [token, tc]);

  useEffect(() => {
    void load();
  }, [load]);

  async function redirectTo(path: string, body?: unknown) {
    if (!token) return;
    setBusy(path);
    setError(null);
    try {
      const { url } = await apiClient<{ url: string }>(path, token, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
      setBusy(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>;
  }

  const unlimited = sub?.usage.limit == null;
  const usagePct =
    sub && sub.usage.limit != null
      ? Math.min(100, Math.round((sub.usage.used / sub.usage.limit) * 100))
      : 0;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">{t("subtitle")}</p>

      {checkout === "success" && (
        <div className="mt-4 rounded-lg border border-[var(--color-success)]/30 bg-[var(--color-success-bg)] px-4 py-3 text-sm text-[var(--color-success)]">
          {t("checkoutSuccess")}
        </div>
      )}
      {checkout === "cancel" && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning)]">
          {t("checkoutCancel")}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      {sub && (
        <>
          {/* Current plan + usage */}
          <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm text-[var(--color-muted)]">
                  {t("currentPlan")}
                </div>
                <div className="mt-1 text-xl font-semibold">
                  {sub.subscribed ? sub.limits.label : t("noActivePlan")}
                  {sub.subscribed && sub.plan !== "SPONSORED" && (
                    <span className="ml-2 text-sm font-normal text-[var(--color-muted)]">
                      {PLAN_PRICING[sub.plan].price}
                      {t("perMonth")}
                    </span>
                  )}
                </div>
                {sub.subscribed && sub.status && (
                  <div className="mt-1 text-xs text-[var(--color-muted)]">
                    {t("statusLine", { status: sub.status })}
                    {sub.currentPeriodEnd &&
                      ` · ${t(
                        sub.status === "trialing" ? "trialEnds" : "renews",
                        {
                          date: new Date(
                            sub.currentPeriodEnd,
                          ).toLocaleDateString(),
                        },
                      )}`}
                  </div>
                )}
                {!sub.subscribed && (
                  <div className="mt-1 text-xs text-[var(--color-muted)]">
                    {t("pickPlanHint")}
                  </div>
                )}
              </div>
              {isOwner && sub.hasCustomer && (
                <button
                  onClick={() => redirectTo("/billing/portal")}
                  disabled={busy !== null}
                  className="btn-ghost shrink-0 disabled:opacity-50"
                >
                  {busy === "/billing/portal"
                    ? t("opening")
                    : t("manageBilling")}
                </button>
              )}
            </div>

            {sub.subscribed && (
              <div className="mt-5">
                <div className="mb-1 flex justify-between text-xs text-[var(--color-muted)]">
                  <span>{t("messagesThisMonth")}</span>
                  <span>
                    {sub.usage.used.toLocaleString()} /{" "}
                    {unlimited
                      ? t("unlimited")
                      : sub.usage.limit!.toLocaleString()}
                  </span>
                </div>
                {!unlimited && (
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div
                      className={`h-full rounded-full ${
                        usagePct >= 100
                          ? "bg-red-500"
                          : usagePct >= 80
                            ? "bg-amber-500"
                            : "bg-[var(--color-brand)]"
                      }`}
                      style={{ width: `${usagePct}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Plans */}
          {sub.plan === "SPONSORED" ? (
            <p className="mt-6 text-sm text-[var(--color-muted)]">
              {t("sponsoredNote")}
            </p>
          ) : !isOwner ? (
            <p className="mt-6 text-sm text-[var(--color-muted)]">
              {t("ownerOnly")}
            </p>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {PLAN_ORDER.map((plan) => {
                const current = sub.subscribed && plan === sub.plan;
                return (
                  <div
                    key={plan}
                    className={`flex flex-col rounded-xl border p-5 ${
                      current
                        ? "border-[var(--color-brand)] bg-[var(--color-surface)]"
                        : "border-[var(--color-border)] bg-[var(--color-surface)]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">
                        {PLAN_PRICING[plan].label}
                      </h3>
                      {current && (
                        <span className="rounded-full bg-[var(--color-brand)]/15 px-2 py-0.5 text-xs text-[var(--color-brand)]">
                          {t("current")}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-2xl font-bold">
                      {PLAN_PRICING[plan].price}
                      <span className="text-sm font-normal text-[var(--color-muted)]">
                        {t("perMonth")}
                      </span>
                    </div>
                    <ul className="mt-4 flex-1 space-y-2 text-sm text-[var(--color-muted)]">
                      {(t.raw(`features.${plan}`) as string[]).map((f) => (
                        <li key={f}>· {f}</li>
                      ))}
                    </ul>
                    <button
                      onClick={() => redirectTo("/billing/checkout", { plan })}
                      disabled={current || busy !== null}
                      className={`mt-4 w-full ${
                        current ? "btn-ghost" : "btn-primary"
                      } disabled:opacity-50`}
                    >
                      {current
                        ? t("currentPlanBtn")
                        : busy === "/billing/checkout"
                          ? t("redirecting")
                          : t("choosePlan")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingContent />
    </Suspense>
  );
}
