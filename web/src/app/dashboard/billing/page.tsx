"use client";

import { apiClient } from "@/lib/client-api";
import { PLAN_PRICING, type Plan, type Subscription } from "@/lib/types";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

const PLAN_ORDER: Plan[] = ["STARTER", "PRO", "BUSINESS"];

const PLAN_FEATURES: Record<Plan, string[]> = {
  STARTER: ["1 WhatsApp number", "5,000 messages / month", "30-day history"],
  PRO: [
    "3 WhatsApp numbers",
    "10,000 messages / month",
    "90-day history",
    "AI agents & team roles",
  ],
  BUSINESS: [
    "10 WhatsApp numbers",
    "100,000 messages / month",
    "Full history",
    "Priority support",
  ],
};

function BillingContent() {
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
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token]);

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
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--color-muted)]">Loading…</p>;
  }

  const usagePct = sub
    ? Math.min(100, Math.round((sub.usage.used / sub.usage.limit) * 100))
    : 0;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">Billing</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Manage your subscription and see this month&apos;s usage.
      </p>

      {checkout === "success" && (
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          Payment received — your subscription is active.
        </div>
      )}
      {checkout === "cancel" && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Checkout canceled — no changes were made.
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
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
                  Current plan
                </div>
                <div className="mt-1 text-xl font-semibold">
                  {sub.limits.label}
                  <span className="ml-2 text-sm font-normal text-[var(--color-muted)]">
                    {PLAN_PRICING[sub.plan].price}/mo
                  </span>
                </div>
                {sub.status && (
                  <div className="mt-1 text-xs text-[var(--color-muted)]">
                    Status: {sub.status}
                    {sub.currentPeriodEnd &&
                      ` · renews ${new Date(
                        sub.currentPeriodEnd,
                      ).toLocaleDateString()}`}
                  </div>
                )}
              </div>
              {isOwner && sub.hasCustomer && (
                <button
                  onClick={() => redirectTo("/billing/portal")}
                  disabled={busy !== null}
                  className="btn-ghost shrink-0 disabled:opacity-50"
                >
                  {busy === "/billing/portal" ? "Opening…" : "Manage billing"}
                </button>
              )}
            </div>

            <div className="mt-5">
              <div className="mb-1 flex justify-between text-xs text-[var(--color-muted)]">
                <span>Messages this month</span>
                <span>
                  {sub.usage.used.toLocaleString()} /{" "}
                  {sub.usage.limit.toLocaleString()}
                </span>
              </div>
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
            </div>
          </section>

          {/* Plans */}
          {!isOwner ? (
            <p className="mt-6 text-sm text-[var(--color-muted)]">
              Only the organization owner can change the plan.
            </p>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {PLAN_ORDER.map((plan) => {
                const current = plan === sub.plan;
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
                          Current
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-2xl font-bold">
                      {PLAN_PRICING[plan].price}
                      <span className="text-sm font-normal text-[var(--color-muted)]">
                        /mo
                      </span>
                    </div>
                    <ul className="mt-4 flex-1 space-y-2 text-sm text-[var(--color-muted)]">
                      {PLAN_FEATURES[plan].map((f) => (
                        <li key={f}>· {f}</li>
                      ))}
                    </ul>
                    <button
                      onClick={() =>
                        redirectTo("/billing/checkout", { plan })
                      }
                      disabled={current || busy !== null}
                      className={`mt-4 w-full ${
                        current ? "btn-ghost" : "btn-primary"
                      } disabled:opacity-50`}
                    >
                      {current
                        ? "Current plan"
                        : busy === "/billing/checkout"
                          ? "Redirecting…"
                          : "Choose plan"}
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
