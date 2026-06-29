import type { WaStatus } from "@/lib/types";

const MAP: Record<WaStatus, { label: string; cls: string }> = {
  CONNECTED: { label: "Connected", cls: "bg-[var(--color-brand)]/15 text-[var(--color-brand)]" },
  QR: { label: "Scan QR", cls: "bg-amber-500/15 text-amber-300" },
  CONNECTING: { label: "Connecting", cls: "bg-amber-500/15 text-amber-300" },
  PENDING: { label: "Pending", cls: "bg-white/10 text-[var(--color-muted)]" },
  DISCONNECTED: { label: "Disconnected", cls: "bg-orange-500/15 text-orange-300" },
  LOGGED_OUT: { label: "Logged out", cls: "bg-red-500/15 text-red-300" },
};

export function StatusBadge({ status }: { status: WaStatus }) {
  const { label, cls } = MAP[status] ?? MAP.PENDING;
  return (
    <span className={`badge ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
