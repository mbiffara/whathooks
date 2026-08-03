import { AdminMessageCap } from "@/components/admin-message-cap";
import { Glyph } from "@/components/glyphs";
import { AdminOrgSwitch } from "@/components/admin-org-switch";
import { AdminWelcomeEmail } from "@/components/admin-welcome-email";
import { StatusBadge } from "@/components/status-badge";
import { apiServer } from "@/lib/api";
import type { AdminOrgDetail } from "@/lib/types";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function AdminOrgPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await apiServer<AdminOrgDetail>(
    `/admin/organizations/${id}`,
  ).catch(() => null);
  if (!org) notFound();

  const stats = [
    { label: "Users", value: org.users.length },
    { label: "Sessions", value: org.sessions.length },
    { label: "Webhooks", value: org.webhooks.length },
    { label: "API keys", value: org.apiKeys.length },
    { label: "Conversations", value: org.counts.conversations },
    { label: "Messages", value: org.counts.messages },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/admin"
          className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          <Glyph name="chevronLeft" size={14} />
          Admin Console
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{org.name}</h1>
          <AdminOrgSwitch organizationId={org.id} />
        </div>
        <p className="text-sm text-[var(--color-muted)]">
          Org ID <span className="pill">{org.id}</span> · joined{" "}
          {new Date(org.createdAt).toLocaleDateString()}
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

      <Section title="Billing">
        <div className="card flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-lg font-semibold">
              {org.billing.planLabel}
            </span>
            <span
              className={`badge ${
                org.billing.subscriptionStatus === "active"
                  ? "bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
                  : org.billing.subscriptionStatus === "trialing"
                    ? "bg-[var(--color-warning-bg)] text-[var(--color-warning)]"
                    : org.billing.subscriptionStatus === "past_due"
                      ? "bg-[var(--color-warning-bg)] text-[var(--color-warning)]"
                      : org.billing.subscriptionStatus
                        ? "bg-[var(--color-danger-bg)] text-[var(--color-danger)]"
                        : "bg-[var(--color-chip)] text-[var(--color-muted)]"
              }`}
            >
              {org.billing.subscriptionStatus ?? "no subscription"}
            </span>
            {org.billing.currentPeriodEnd && (
              <span className="text-xs text-[var(--color-muted)]">
                {org.billing.subscriptionStatus === "trialing"
                  ? "trial ends"
                  : "renews"}{" "}
                {new Date(org.billing.currentPeriodEnd).toLocaleDateString()}
              </span>
            )}
          </div>
          <div className="text-sm text-[var(--color-muted)]">
            Messages this month:{" "}
            <span className="font-medium text-[var(--color-fg)]">
              {org.billing.usage.used.toLocaleString()}
            </span>{" "}
            /{" "}
            {org.billing.usage.limit == null
              ? "Unlimited"
              : org.billing.usage.limit.toLocaleString()}
          </div>
          <AdminMessageCap
            organizationId={org.id}
            override={org.billing.messageLimitOverride}
          />
          <div className="flex flex-wrap gap-2 text-xs">
            {org.billing.stripeCustomerId ? (
              <a
                href={`https://dashboard.stripe.com/customers/${org.billing.stripeCustomerId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="pill hover:text-[var(--color-brand)]"
              >
                {org.billing.stripeCustomerId} ↗
              </a>
            ) : (
              <span className="pill">no Stripe customer</span>
            )}
            {org.billing.stripeSubscriptionId && (
              <a
                href={`https://dashboard.stripe.com/subscriptions/${org.billing.stripeSubscriptionId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="pill hover:text-[var(--color-brand)]"
              >
                {org.billing.stripeSubscriptionId} ↗
              </a>
            )}
          </div>
        </div>
      </Section>

      <Section title="WhatsApp sessions">
        {org.sessions.length === 0 ? (
          <Empty>No sessions.</Empty>
        ) : (
          <Table head={["Label", "Status", "Number", "Last connected"]}>
            {org.sessions.map((s) => (
              <tr key={s.id} className="row">
                <td className="cell font-medium">{s.label}</td>
                <td className="cell">
                  <StatusBadge status={s.status} />
                </td>
                <td className="cell font-mono text-xs">
                  {s.phoneNumber ? `+${s.phoneNumber}` : "—"}
                </td>
                <td className="cell text-xs text-[var(--color-muted)]">
                  {s.lastConnectedAt
                    ? new Date(s.lastConnectedAt).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Users">
        <Table head={["Email", "Name", "Role", "Joined", ""]}>
          {org.users.map((u) => (
            <tr key={u.id} className="row">
              <td className="cell font-mono text-xs">{u.email}</td>
              <td className="cell">{u.name ?? "—"}</td>
              <td className="cell">
                <span
                  className={`badge ${
                    u.orgRole === "OWNER"
                      ? "bg-[var(--color-warning-bg)] text-[var(--color-warning)]"
                      : u.orgRole === "ADMIN"
                        ? "bg-[var(--color-info-bg)] text-[var(--color-info)]"
                        : "bg-[var(--color-chip)] text-[var(--color-muted)]"
                  }`}
                >
                  {u.orgRole.toLowerCase()}
                </span>
                {u.role === "ADMIN" && (
                  <span className="badge ml-1.5 bg-[var(--color-brand)]/15 text-[var(--color-brand)]">
                    platform admin
                  </span>
                )}
              </td>
              <td className="cell text-xs text-[var(--color-muted)]">
                {new Date(u.createdAt).toLocaleDateString()}
              </td>
              <td className="cell text-right">
                <AdminWelcomeEmail
                  userId={u.id}
                  email={u.email}
                  defaultLocale={u.locale}
                  sentAt={u.welcomeEmailSentAt}
                />
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Webhooks">
        {org.webhooks.length === 0 ? (
          <Empty>No webhooks.</Empty>
        ) : (
          <Table head={["URL", "Events", "Active"]}>
            {org.webhooks.map((w) => (
              <tr key={w.id} className="row">
                <td className="cell max-w-xs truncate font-mono text-xs">
                  {w.url}
                </td>
                <td className="cell">
                  <div className="flex flex-wrap gap-1">
                    {w.events.map((e) => (
                      <span key={e} className="pill">
                        {e}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="cell">{w.active ? "Yes" : "No"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="API keys">
        {org.apiKeys.length === 0 ? (
          <Empty>No API keys.</Empty>
        ) : (
          <Table head={["Name", "Prefix", "Last used", "Status"]}>
            {org.apiKeys.map((k) => (
              <tr key={k.id} className="row">
                <td className="cell font-medium">{k.name}</td>
                <td className="cell font-mono text-xs">{k.prefix}</td>
                <td className="cell text-xs text-[var(--color-muted)]">
                  {k.lastUsedAt
                    ? new Date(k.lastUsedAt).toLocaleString()
                    : "Never"}
                </td>
                <td className="cell">
                  {k.revokedAt ? (
                    <span className="badge bg-[var(--color-danger-bg)] text-[var(--color-danger)]">
                      revoked
                    </span>
                  ) : (
                    <span className="badge bg-[var(--color-brand)]/15 text-[var(--color-brand)]">
                      active
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="card text-sm text-[var(--color-muted)]">{children}</div>
  );
}

function Table({
  head,
  children,
}: {
  head: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm [&_.cell]:px-4 [&_.cell]:py-3 [&_.row]:border-b [&_.row]:border-[var(--color-border)] [&_.row:last-child]:border-0">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase text-[var(--color-muted)]">
            {head.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
