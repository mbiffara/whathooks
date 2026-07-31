"use client";

import { apiClient } from "@/lib/client-api";
import type { WebhookDelivery } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { Fragment, useCallback, useEffect, useState } from "react";

interface DeliveriesPage {
  items: WebhookDelivery[];
  hasMore: boolean;
  nextBefore: string | null;
}

function StatusBadge({ d }: { d: WebhookDelivery }) {
  const t = useTranslations("dash.webhooks");
  if (d.deliveredAt) {
    return (
      <span className="badge bg-[var(--color-success-bg)] text-[var(--color-success)]">
        {d.responseStatus}
      </span>
    );
  }
  if (d.responseStatus != null || d.lastError) {
    return (
      <span className="badge bg-[var(--color-danger-bg)] text-[var(--color-danger)]">
        {d.responseStatus ?? t("deliveryFailed")}
      </span>
    );
  }
  return (
    <span className="badge bg-[var(--color-chip)] text-[var(--color-muted)]">
      {t("deliveryPending")}
    </span>
  );
}

/**
 * Origin summary pulled from the stored payload: chat JID (groups flagged),
 * sender name and sender JID/LID for groups. Payload-mapped webhooks may not
 * carry these fields — render what's there.
 */
function FromCell({ payload }: { payload: Record<string, unknown> }) {
  const data = (payload?.data ?? {}) as Record<string, unknown>;
  const from = typeof data.from === "string" ? data.from : null;
  if (!from) return <span className="text-[var(--color-muted)]">—</span>;
  const isGroup = data.isGroup === true || from.endsWith("@g.us");
  const pushName = typeof data.pushName === "string" ? data.pushName : null;
  const participant =
    typeof data.participant === "string" ? data.participant : null;
  return (
    <div className="min-w-0">
      <div className="max-w-56 truncate font-mono text-[11px]" title={from}>
        {isGroup && <span title="Group">👥 </span>}
        {from}
      </div>
      {(pushName || participant) && (
        <div
          className="max-w-56 truncate text-[10px] text-[var(--color-muted)]"
          title={[pushName, participant].filter(Boolean).join(" · ")}
        >
          {pushName}
          {pushName && participant && " · "}
          {participant && <span className="font-mono">{participant}</span>}
        </div>
      )}
    </div>
  );
}

/** Recent delivery attempts for one webhook: status, error, payload. */
export function WebhookDeliveries({ webhookId }: { webhookId: string }) {
  const t = useTranslations("dash.webhooks");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const page = await apiClient<DeliveriesPage>(
        `/webhooks/${webhookId}/deliveries`,
        token,
      );
      setDeliveries(page.items);
      setNextBefore(page.hasMore ? page.nextBefore : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    }
  }, [token, webhookId, tc]);

  async function loadMore() {
    if (!token || !nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiClient<DeliveriesPage>(
        `/webhooks/${webhookId}/deliveries?before=${encodeURIComponent(nextBefore)}`,
        token,
      );
      setDeliveries((prev) => [...(prev ?? []), ...page.items]);
      // Cap the in-page history at 1000 entries (20 pages).
      const total = (deliveries?.length ?? 0) + page.items.length;
      setNextBefore(page.hasMore && total < 1000 ? page.nextBefore : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  if (error)
    return <p className="text-sm text-[var(--color-danger)]">{error}</p>;
  if (deliveries === null)
    return <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>;
  if (deliveries.length === 0)
    return (
      <p className="text-sm text-[var(--color-muted)]">{t("noDeliveries")}</p>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--color-muted)]">
          {t("deliveriesHint")}
        </p>
        <button onClick={load} className="btn-ghost text-xs">
          {t("refresh")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase text-[var(--color-muted)]">
              <th className="px-2 py-2 font-medium">{t("deliveryTime")}</th>
              <th className="px-2 py-2 font-medium">{t("deliveryEvent")}</th>
              <th className="px-2 py-2 font-medium">{t("deliveryFrom")}</th>
              <th className="px-2 py-2 font-medium">{t("deliveryStatus")}</th>
              <th className="px-2 py-2 font-medium">{t("deliveryError")}</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <Fragment key={d.id}>
                <tr className="border-b border-[var(--color-border)] last:border-0">
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-[var(--color-muted)]">
                    {new Date(d.createdAt).toLocaleString()}
                  </td>
                  <td className="px-2 py-2 text-xs">{d.event}</td>
                  <td className="px-2 py-2">
                    <FromCell payload={d.payload} />
                  </td>
                  <td className="px-2 py-2">
                    <StatusBadge d={d} />
                  </td>
                  <td className="max-w-56 truncate px-2 py-2 text-xs text-[var(--color-danger)]">
                    {d.lastError ?? ""}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      onClick={() =>
                        setOpenId((v) => (v === d.id ? null : d.id))
                      }
                      className="text-xs text-[var(--color-brand)] hover:underline"
                    >
                      {openId === d.id ? tc("close") : t("deliveryPayload")}
                    </button>
                  </td>
                </tr>
                {openId === d.id && (
                  <tr>
                    <td colSpan={6} className="px-2 pb-3">
                      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--color-surface-2)] p-3 font-mono text-xs">
                        {JSON.stringify(d.payload, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {nextBefore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="btn-ghost self-center text-xs"
        >
          {loadingMore ? tc("loading") : t("loadMore")}
        </button>
      )}
    </div>
  );
}
