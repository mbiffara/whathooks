import type { WaStatus } from "@/lib/types";
import { useTranslations } from "next-intl";

const CLS: Record<WaStatus, string> = {
  CONNECTED: "bg-[var(--color-brand)]/15 text-[var(--color-brand)]",
  QR: "bg-[var(--color-warning-bg)] text-[var(--color-warning)]",
  CONNECTING: "bg-[var(--color-warning-bg)] text-[var(--color-warning)]",
  PENDING: "bg-[var(--color-chip)] text-[var(--color-muted)]",
  DISCONNECTED: "bg-[var(--color-warning-bg)] text-[var(--color-warning)]",
  LOGGED_OUT: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
};

export function StatusBadge({ status }: { status: WaStatus }) {
  const t = useTranslations("dash.status");
  const known = status in CLS ? status : "PENDING";
  return (
    <span className={`badge ${CLS[known]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {t(known)}
    </span>
  );
}
