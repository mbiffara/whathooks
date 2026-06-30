import { apiServer } from "@/lib/api";
import type { AdminOrg, AdminOverview } from "@/lib/types";
import Link from "next/link";

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
            <div className="mt-1 text-xs text-[var(--color-muted)]">{s.label}</div>
          </div>
        ))}
      </div>

      <section className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase text-[var(--color-muted)]">
              <th className="px-4 py-3 font-medium">Organization</th>
              <th className="px-4 py-3 font-medium">Users</th>
              <th className="px-4 py-3 font-medium">Sessions</th>
              <th className="px-4 py-3 font-medium">Webhooks</th>
              <th className="px-4 py-3 font-medium">Chats</th>
              <th className="px-4 py-3 font-medium">Messages</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
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
                <td className="px-4 py-3">{o.users}</td>
                <td className="px-4 py-3">{o.sessions}</td>
                <td className="px-4 py-3">{o.webhooks}</td>
                <td className="px-4 py-3">{o.conversations}</td>
                <td className="px-4 py-3">{o.messages}</td>
                <td className="px-4 py-3 text-xs text-[var(--color-muted)]">
                  {new Date(o.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/organizations/${o.id}`}
                    className="text-sm text-[var(--color-brand)]"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
