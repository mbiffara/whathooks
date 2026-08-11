"use client";

import { AiTokensCard } from "@/components/ai-tokens-card";
import { InstagramSeatsCard } from "@/components/instagram-seats-card";
import { apiClient } from "@/lib/client-api";
import type { AiTokenPurchase } from "@/lib/types";
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
  const tt = useTranslations("dash.tokens");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const isOwner = auth?.user?.orgRole === "OWNER";
  const params = useSearchParams();
  const checkout = params.get("checkout");

  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<AiTokenPurchase[]>([]);

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

  useEffect(() => {
    if (!token) return;
    apiClient<AiTokenPurchase[]>("/billing/ai-tokens/purchases", token)
      .then(setPurchases)
      .catch(() => setPurchases([]));
  }, [token]);

  const [billingInterval, setBillingInterval] = useState<"month" | "year">(
    "month",
  );

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

  // Never subscribed before (status is only ever set once a subscription
  // exists) — checkout will grant the 7-day trial, so the CTA can say so.
  const trialEligible = !!sub && !sub.subscribed && sub.status === null;

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
              {/* hasCustomer alone is true after merely starting a checkout,
                  which showed a portal link to orgs that never subscribed.
                  A non-null status means a subscription exists or existed, so
                  cancelled customers keep access to their invoices. */}
              {isOwner && (sub.subscribed || sub.status !== null) && (
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
              <div className="mt-5 flex flex-col gap-4">
                <Meter
                  label={t("messagesThisMonth")}
                  used={sub.usage.used}
                  limit={sub.usage.limit}
                  unlimitedLabel={t("unlimited")}
                />
                <Meter
                  label={t("aiTokensThisMonth")}
                  used={sub.aiTokens.used}
                  limit={sub.aiTokens.limit}
                  unlimitedLabel={t("unlimited")}
                  note={t("aiTokensNote")}
                />
              </div>
            )}
          </section>

          <section className="mt-6">
            <AiTokensCard isOwner={isOwner} />
          </section>

          <section className="mt-6">
            <InstagramSeatsCard
              sub={sub}
              isOwner={isOwner}
              onChanged={load}
            />
          </section>

          {purchases.length > 0 && (
            <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h2 className="font-semibold">{tt("purchasesTitle")}</h2>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {purchases.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-[var(--color-border)] last:border-0"
                    >
                      <td className="py-2">
                        {tt("purchaseRow", {
                          tokens: p.tokens.toLocaleString(),
                        })}
                      </td>
                      <td className="py-2 text-[var(--color-muted)]">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {(p.amountCents / 100).toLocaleString(undefined, {
                          style: "currency",
                          currency: p.currency.toUpperCase(),
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

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
            <>
              {/* Segmented control: one track, the chosen half raised out of
                it. Two separate pills read as two independent buttons. */}
              <div
                role="group"
                aria-label={t("intervalLabel")}
                className="mt-6 inline-flex rounded-full bg-[var(--color-surface-2)] p-1"
              >
                {(["month", "year"] as const).map((iv) => {
                  const active = billingInterval === iv;
                  return (
                    <button
                      key={iv}
                      onClick={() => setBillingInterval(iv)}
                      aria-pressed={active}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-xs font-semibold transition-colors ${
                        active
                          ? "bg-[var(--color-surface)] text-[var(--color-fg)] shadow-sm"
                          : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                      }`}
                    >
                      {iv === "month"
                        ? t("intervalMonthly")
                        : t("intervalAnnual")}
                      {iv === "year" && (
                        <span
                          className={
                            active
                              ? "text-[10px] font-semibold text-[var(--color-brand)]"
                              : "text-[10px] font-semibold text-[var(--color-muted)]"
                          }
                        >
                          {t("annualBadge")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
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
                        {billingInterval === "year"
                          ? PLAN_PRICING[plan].annualPrice
                          : PLAN_PRICING[plan].price}
                        <span className="text-sm font-normal text-[var(--color-muted)]">
                          {billingInterval === "year"
                            ? t("perYear")
                            : t("perMonth")}
                        </span>
                      </div>
                      {billingInterval === "year" && (
                        <p className="mt-0.5 text-xs text-[var(--color-brand)]">
                          {t("annualSavings")}
                        </p>
                      )}
                      <ul className="mt-4 flex-1 space-y-2 text-sm text-[var(--color-muted)]">
                        {(t.raw(`features.${plan}`) as string[]).map((f) => (
                          <li key={f}>· {f}</li>
                        ))}
                      </ul>
                      <button
                        onClick={() =>
                          redirectTo("/billing/checkout", {
                            plan,
                            interval: billingInterval,
                          })
                        }
                        disabled={current || busy !== null}
                        className={`mt-4 w-full ${
                          current ? "btn-ghost" : "btn-primary"
                        } disabled:opacity-50`}
                      >
                        {current
                          ? t("currentPlanBtn")
                          : busy === "/billing/checkout"
                            ? t("redirecting")
                            : trialEligible
                              ? t("startTrial")
                              : t("choosePlan")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
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

/** Usage bar shared by the message and AI-token quotas. */
function Meter({
  label,
  used,
  limit,
  unlimitedLabel,
  note,
}: {
  label: string;
  used: number;
  limit: number | null;
  unlimitedLabel: string;
  note?: string;
}) {
  const pct =
    limit == null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-[var(--color-muted)]">
        <span>{label}</span>
        <span>
          {used.toLocaleString()} /{" "}
          {limit == null ? unlimitedLabel : limit.toLocaleString()}
        </span>
      </div>
      {limit != null && (
        <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
          <div
            className={`h-full rounded-full ${
              pct >= 100
                ? "bg-red-500"
                : pct >= 80
                  ? "bg-amber-500"
                  : "bg-[var(--color-brand)]"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {note && (
        <p className="mt-1 text-[10px] text-[var(--color-muted)]">{note}</p>
      )}
    </div>
  );
}
