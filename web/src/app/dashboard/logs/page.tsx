import { ExpandableText } from "@/components/expandable-text";
import { apiServer } from "@/lib/api";
import { getTranslations } from "next-intl/server";
import type { MessageLog } from "@/lib/types";

export default async function LogsPage() {
  const t = await getTranslations("dash.logs");
  const messages = await apiServer<MessageLog[]>("/messages?limit=100").catch(
    () => [],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-[var(--color-muted)]">{t("subtitle")}</p>
      </div>

      {messages.length === 0 ? (
        <div className="card text-sm text-[var(--color-muted)]">
          {t("noMessages")}
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase text-[var(--color-muted)]">
                <th className="px-4 py-3 font-medium">{t("dir")}</th>
                <th className="px-4 py-3 font-medium">{t("contact")}</th>
                <th className="px-4 py-3 font-medium">{t("type")}</th>
                <th className="px-4 py-3 font-medium">{t("message")}</th>
                <th className="px-4 py-3 font-medium">{t("status")}</th>
                <th className="px-4 py-3 font-medium">{t("time")}</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="px-4 py-3">
                    <span
                      className={
                        m.direction === "INBOUND"
                          ? "text-[var(--color-brand)]"
                          : "text-[var(--color-muted)]"
                      }
                    >
                      {m.direction === "INBOUND" ? t("in") : t("out")}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {m.remoteJid.split("@")[0]}
                  </td>
                  <td className="px-4 py-3">{m.type}</td>
                  <td className="px-4 py-3 align-top">
                    {m.text ? <ExpandableText text={m.text} /> : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-muted)]">
                    {m.status}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-muted)]">
                    {new Date(m.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
