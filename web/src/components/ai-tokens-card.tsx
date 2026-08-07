"use client";

import { apiClient } from "@/lib/client-api";
import type { AiTokenReport } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

function compact(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/**
 * Included-AI balance, with the per-day and per-agent breakdown. Only agents
 * on included tokens appear here; ones on the org's own key are unmetered.
 */
export function AiTokensCard({ isOwner }: { isOwner: boolean }) {
  const t = useTranslations("dash.tokens");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [report, setReport] = useState<AiTokenReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"day" | "agent">("day");

  const load = useCallback(async () => {
    if (!token) return;
    await apiClient<AiTokenReport>("/billing/ai-tokens", token)
      .then(setReport)
      .catch(() => setReport(null));
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function buy() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await apiClient<{ url: string }>(
        "/billing/tokens/checkout",
        token,
        { method: "POST" },
      );
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
      setBusy(false);
    }
  }

  if (!report) return null;

  const { included, paid, low, byDay, byAgent } = report;
  const pct =
    included.limit == null
      ? 0
      : Math.min(100, Math.round((included.used / included.limit) * 100));
  const rows = tab === "day" ? byDay : byAgent;

  return (
    <div className={`card ${low ? "border-[var(--color-warning)]/50" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">{t("title")}</h2>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {t("subtitle")}
          </p>
        </div>
        {isOwner && (
          <button
            onClick={buy}
            disabled={busy}
            className="btn-primary shrink-0 text-sm disabled:opacity-50"
          >
            {busy ? t("opening") : t("buy")}
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex justify-between text-xs text-[var(--color-muted)]">
            <span>{t("monthly")}</span>
            <span>
              {compact(included.used)} /{" "}
              {included.limit == null
                ? t("unlimited")
                : compact(included.limit)}
            </span>
          </div>
          {included.limit != null && (
            <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <div
                className={`h-full rounded-full ${
                  pct >= 100
                    ? "bg-red-500"
                    : pct >= 90
                      ? "bg-amber-500"
                      : "bg-[var(--color-brand)]"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          <p className="mt-1 text-[10px] text-[var(--color-muted)]">
            {t("monthlyNote")}
          </p>
        </div>
        <div>
          <div className="mb-1 text-xs text-[var(--color-muted)]">
            {t("purchased")}
          </div>
          <div className="text-xl font-semibold">{compact(paid)}</div>
          <p className="mt-1 text-[10px] text-[var(--color-muted)]">
            {t("purchasedNote")}
          </p>
        </div>
      </div>

      {low && (
        <p className="mt-4 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning)]">
          ⚠ {t("lowWarning")}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
      )}

      {(byDay.length > 0 || byAgent.length > 0) && (
        <div className="mt-5">
          <div
            role="group"
            aria-label={t("breakdown")}
            className="inline-flex rounded-full bg-[var(--color-surface-2)] p-1"
          >
            {(["day", "agent"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                aria-pressed={tab === k}
                className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold transition-colors ${
                  tab === k
                    ? "bg-[var(--color-surface)] text-[var(--color-fg)] shadow-sm"
                    : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                }`}
              >
                {k === "day" ? t("byDay") : t("byAgent")}
              </button>
            ))}
          </div>
          <div className="mt-3 max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="py-2 text-xs text-[var(--color-muted)]">
                      {t("noUsage")}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const label = "day" in r ? r.day : r.name;
                    return (
                      <tr
                        key={label}
                        className="border-b border-[var(--color-border)] last:border-0"
                      >
                        <td className="py-1.5 pr-4">{label}</td>
                        <td className="py-1.5 text-right tabular-nums text-[var(--color-muted)]">
                          {r.tokens.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
