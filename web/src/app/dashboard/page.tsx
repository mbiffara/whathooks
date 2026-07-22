import { StatusBadge } from "@/components/status-badge";
import { apiServer } from "@/lib/api";
import { getTranslations } from "next-intl/server";
import type { ApiKey, MessageLog, WaSession, Webhook } from "@/lib/types";
import Link from "next/link";

export default async function OverviewPage() {
  const t = await getTranslations("dash.overview");
  const [sessions, webhooks, apiKeys, messages] = await Promise.all([
    apiServer<WaSession[]>("/sessions").catch(() => []),
    apiServer<Webhook[]>("/webhooks").catch(() => []),
    apiServer<ApiKey[]>("/api-keys").catch(() => []),
    apiServer<MessageLog[]>("/messages?limit=8").catch(() => []),
  ]);

  const connected = sessions.filter((s) => s.status === "CONNECTED").length;
  const stats = [
    {
      label: t("statSessions"),
      value: sessions.length,
      href: "/dashboard/sessions",
    },
    {
      label: t("statConnected"),
      value: connected,
      href: "/dashboard/sessions",
    },
    {
      label: t("statWebhooks"),
      value: webhooks.length,
      href: "/dashboard/webhooks",
    },
    {
      label: t("statApiKeys"),
      value: apiKeys.filter((k) => !k.revokedAt).length,
      href: "/dashboard/api-keys",
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-[var(--color-muted)]">{t("subtitle")}</p>
        </div>
        <Link href="/dashboard/sessions" className="btn-primary">
          {t("connectNumber")}
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="card hover:border-[var(--color-brand)]/50"
          >
            <div className="text-3xl font-bold">{s.value}</div>
            <div className="mt-1 text-sm text-[var(--color-muted)]">
              {s.label}
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">{t("sessions")}</h2>
            <Link
              href="/dashboard/sessions"
              className="text-sm text-[var(--color-brand)]"
            >
              {t("viewAll")}
            </Link>
          </div>
          {sessions.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">
              {t("noSessions")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--color-border)]">
              {sessions.slice(0, 5).map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between py-2.5"
                >
                  <Link
                    href={`/dashboard/sessions/${s.id}`}
                    className="text-sm hover:text-[var(--color-brand)]"
                  >
                    {s.label}
                    {s.phoneNumber && (
                      <span className="ml-2 text-[var(--color-muted)]">
                        +{s.phoneNumber}
                      </span>
                    )}
                  </Link>
                  <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">{t("recentMessages")}</h2>
            <Link
              href="/dashboard/logs"
              className="text-sm text-[var(--color-brand)]"
            >
              {t("viewLog")}
            </Link>
          </div>
          {messages.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">
              {t("noMessages")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--color-border)]">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm"
                >
                  <span className="truncate">
                    <span
                      className={
                        m.direction === "INBOUND"
                          ? "text-[var(--color-brand)]"
                          : "text-[var(--color-muted)]"
                      }
                    >
                      {m.direction === "INBOUND" ? "←" : "→"}
                    </span>{" "}
                    {m.text ?? `[${m.type}]`}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--color-muted)]">
                    {m.remoteJid.split("@")[0]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
