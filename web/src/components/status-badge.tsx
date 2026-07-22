import type { WaStatus } from "@/lib/types";
import { useTranslations } from "next-intl";

const CLS: Record<WaStatus, string> = {
  CONNECTED: "bg-[var(--color-brand)]/15 text-[var(--color-brand)]",
  QR: "bg-amber-500/15 text-amber-300",
  CONNECTING: "bg-amber-500/15 text-amber-300",
  PENDING: "bg-white/10 text-[var(--color-muted)]",
  DISCONNECTED: "bg-orange-500/15 text-orange-300",
  LOGGED_OUT: "bg-red-500/15 text-red-300",
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
