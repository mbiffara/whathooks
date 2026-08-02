import { AdminOrgTable } from "@/components/admin-org-table";
import { apiServer } from "@/lib/api";
import type { AdminOrg, AdminOverview } from "@/lib/types";

export default async function AdminPage() {
  const [overview, orgs] = await Promise.all([
    apiServer<AdminOverview>("/admin/overview").catch(() => null),
    apiServer<AdminOrg[]>("/admin/organizations").catch(() => []),
  ]);

  const stats = overview
    ? [
        { label: "Organizations", value: overview.organizations },
        { label: "Users", value: overview.users },
        { label: "Sessions", value: overview.sessions },
        { label: "Connected", value: overview.connected },
        { label: "Conversations", value: overview.conversations },
        { label: "Messages", value: overview.messages },
      ]
    : [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Admin Console</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Platform-wide metrics across all organizations.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <div className="text-2xl font-bold">{s.value}</div>
            <div className="mt-1 text-xs text-[var(--color-muted)]">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {overview?.system && <SystemHealth system={overview.system} />}

      <AdminOrgTable orgs={orgs} />
    </div>
  );
}

function SystemHealth({
  system,
}: {
  system: NonNullable<AdminOverview["system"]>;
}) {
  const pct = system.memoryPercent;
  const barColor =
    pct == null
      ? "bg-[var(--color-brand)]"
      : pct >= 85
        ? "bg-red-400"
        : pct >= 70
          ? "bg-amber-400"
          : "bg-[var(--color-brand)]";

  return (
    <section className="card flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">API process</h2>
        <span className="text-xs text-[var(--color-muted)]">
          live worker · refresh to update
        </span>
      </div>
      <div className="grid gap-6 sm:grid-cols-3">
        <div>
          <div className="text-2xl font-bold">{system.liveSessions}</div>
          <div className="mt-1 text-xs text-[var(--color-muted)]">
            Live WhatsApp sockets
          </div>
        </div>
        <div className="sm:col-span-2">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm font-medium">Memory</span>
            <span className="text-sm text-[var(--color-muted)]">
              {system.memoryUsedMB} MB
              {system.memoryLimitMB
                ? ` / ${system.memoryLimitMB} MB${pct != null ? ` (${pct}%)` : ""}`
                : ""}
            </span>
          </div>
          {system.memoryLimitMB ? (
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <div
                className={`h-full ${barColor}`}
                style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
              />
            </div>
          ) : (
            <p className="text-xs text-[var(--color-muted)]">
              Limit unavailable (local/dev)
            </p>
          )}
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Uptime {formatUptime(system.uptimeSeconds)} · alarm fires at 75%
          </p>
        </div>
      </div>
    </section>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
