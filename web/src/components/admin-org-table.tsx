"use client";

import { AdminWelcomeEmail } from "@/components/admin-welcome-email";
import { Glyph } from "@/components/glyphs";
import type { AdminOrg, Plan } from "@/lib/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

const PLANS: readonly Plan[] = ["STARTER", "PRO", "BUSINESS", "SPONSORED"];

/** Stripe subscription statuses we always offer as filter options. */
const SUB_STATUSES = ["active", "trialing", "past_due", "canceled"] as const;
const SUB_STATUS_LABEL: Record<(typeof SUB_STATUSES)[number], string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  canceled: "Canceled",
};
/** Filter value for organizations without a subscription (`subscriptionStatus === null`). */
const NONE = "NONE";

function parsePlan(value: string | null): "ALL" | Plan {
  return PLANS.includes(value as Plan) ? (value as Plan) : "ALL";
}

function parseStatus(value: string | null, known: readonly string[]): string {
  if (!value) return "ALL";
  if (value === NONE || known.includes(value)) return value;
  return "ALL";
}

const SUB_BADGE: Record<string, string> = {
  active: "bg-[var(--color-brand)]/15 text-[var(--color-brand)]",
  trialing: "bg-[var(--color-warning-bg)] text-[var(--color-warning)]",
  past_due: "bg-[var(--color-warning-bg)] text-[var(--color-warning)]",
  canceled: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
};

function SubscriptionBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="badge bg-[var(--color-chip)] text-[var(--color-muted)]">
        none
      </span>
    );
  }
  return (
    <span
      className={`badge ${SUB_BADGE[status] ?? "bg-[var(--color-chip)] text-[var(--color-muted)]"}`}
    >
      {status}
    </span>
  );
}

/**
 * Admin org list with client-side search + plan/status filters.
 * Plan and status are mirrored to the URL (`?plan=PRO&status=canceled`) so a
 * filtered view can be shared or reloaded; the text search is not.
 */
export function AdminOrgTable({ orgs }: { orgs: AdminOrg[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /** Statuses present in the data that we don't list by default (e.g. `unpaid`). */
  const extraStatuses = useMemo(() => {
    const known = new Set<string>(SUB_STATUSES);
    const extra = new Set<string>();
    for (const o of orgs) {
      if (o.subscriptionStatus !== null && !known.has(o.subscriptionStatus)) {
        extra.add(o.subscriptionStatus);
      }
    }
    return [...extra].sort();
  }, [orgs]);

  const [q, setQ] = useState("");
  const [plan, setPlan] = useState<"ALL" | Plan>(() =>
    parsePlan(searchParams.get("plan")),
  );
  const [status, setStatus] = useState<string>(() =>
    parseStatus(searchParams.get("status"), [
      ...SUB_STATUSES,
      ...extraStatuses,
    ]),
  );

  function syncUrl(next: { plan: string; status: string }) {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["plan", "status"] as const) {
      if (next[key] === "ALL") params.delete(key);
      else params.set(key, next[key]);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function changePlan(value: string) {
    const nextPlan = parsePlan(value);
    setPlan(nextPlan);
    syncUrl({ plan: nextPlan, status });
  }

  function changeStatus(value: string) {
    setStatus(value);
    syncUrl({ plan, status: value });
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return orgs.filter((o) => {
      if (plan !== "ALL" && o.plan !== plan) return false;
      if (status === NONE && o.subscriptionStatus !== null) return false;
      if (status !== "ALL" && status !== NONE && o.subscriptionStatus !== status)
        return false;
      if (
        needle &&
        !o.name.toLowerCase().includes(needle) &&
        !(o.owner?.email.toLowerCase().includes(needle) ?? false)
      )
        return false;
      return true;
    });
  }, [orgs, q, plan, status]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input max-w-xs"
          placeholder="Search org name or owner email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input w-40"
          value={plan}
          onChange={(e) => changePlan(e.target.value)}
        >
          <option value="ALL">All plans</option>
          <option value="STARTER">Starter</option>
          <option value="PRO">Pro</option>
          <option value="BUSINESS">Business</option>
          <option value="SPONSORED">Sponsored</option>
        </select>
        <select
          className="input w-40"
          value={status}
          onChange={(e) => changeStatus(e.target.value)}
        >
          <option value="ALL">All statuses</option>
          {SUB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SUB_STATUS_LABEL[s]}
            </option>
          ))}
          {extraStatuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          <option value={NONE}>No subscription</option>
        </select>
        <span className="ml-auto text-xs text-[var(--color-muted)]">
          {filtered.length} / {orgs.length}
        </span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase text-[var(--color-muted)]">
              <th className="px-4 py-3 font-medium">Organization</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Users</th>
              <th className="px-4 py-3 font-medium">Sessions</th>
              <th className="px-4 py-3 font-medium">Agents</th>
              <th className="px-4 py-3 font-medium">Webhooks</th>
              <th className="px-4 py-3 font-medium">Chats</th>
              <th className="px-4 py-3 font-medium">Messages</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3"></th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr
                key={o.id}
                className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]/50"
              >
                <td className="px-4 py-3 font-medium">
                  <Link
                    href={`/admin/organizations/${o.id}`}
                    className="hover:text-[var(--color-brand)]"
                  >
                    {o.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs">{o.plan}</span>
                    <SubscriptionBadge status={o.subscriptionStatus} />
                  </div>
                  {o.subscriptionStatus === "trialing" &&
                    o.currentPeriodEnd && (
                      <div className="mt-0.5 text-[10px] text-[var(--color-muted)]">
                        trial ends{" "}
                        {new Date(o.currentPeriodEnd).toLocaleDateString()}
                      </div>
                    )}
                </td>
                <td className="px-4 py-3">{o.users}</td>
                <td className="px-4 py-3">{o.sessions}</td>
                <td className="px-4 py-3">{o.agents}</td>
                <td className="px-4 py-3">{o.webhooks}</td>
                <td className="px-4 py-3">{o.conversations}</td>
                <td className="px-4 py-3">{o.messages}</td>
                <td className="px-4 py-3 text-xs text-[var(--color-muted)]">
                  {new Date(o.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  {o.owner && (
                    <AdminWelcomeEmail
                      userId={o.owner.id}
                      email={o.owner.email}
                      defaultLocale={o.owner.locale}
                      sentAt={o.owner.welcomeEmailSentAt}
                    />
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/organizations/${o.id}`}
                    className="inline-flex items-center gap-0.5 text-sm text-[var(--color-brand)]"
                  >
                    View
                    <Glyph name="chevronRight" size={14} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
