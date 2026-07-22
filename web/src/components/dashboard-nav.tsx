"use client";

import { Logo } from "@/components/logo";
import { OrgSwitcher } from "@/components/org-switcher";
import { useTranslations } from "next-intl";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: string; key: string; exact?: boolean }[] = [
  { href: "/dashboard", key: "overview", exact: true },
  { href: "/dashboard/sessions", key: "sessions" },
  { href: "/dashboard/messages", key: "messages" },
  { href: "/dashboard/agents", key: "agents" },
  { href: "/dashboard/webhooks", key: "webhooks" },
  { href: "/dashboard/api-keys", key: "apiKeys" },
  { href: "/dashboard/logs", key: "logs" },
  { href: "/dashboard/team", key: "team" },
  { href: "/dashboard/billing", key: "billing" },
  { href: "/dashboard/settings", key: "settings" },
];

export function DashboardNav() {
  const t = useTranslations("dash.nav");
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  function isActive(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="px-2 py-2">
        <Logo href="/dashboard" />
      </div>
      <OrgSwitcher />
      <nav className="mt-4 flex flex-1 flex-col gap-1">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-3 py-2 text-sm transition-colors ${
              isActive(l.href, l.exact)
                ? "bg-[var(--color-surface-2)] font-medium text-[var(--color-fg)]"
                : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
            }`}
          >
            {t(l.key)}
          </Link>
        ))}
        {isAdmin && (
          <Link
            href="/admin"
            className={`mt-2 rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname.startsWith("/admin")
                ? "bg-[var(--color-surface-2)] font-medium text-[var(--color-brand)]"
                : "text-[var(--color-brand)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            {t("admin")}
          </Link>
        )}
      </nav>
      <div className="border-t border-[var(--color-border)] pt-3">
        <div className="px-3 pb-2 text-xs text-[var(--color-muted)]">
          {session?.user?.email}
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
        >
          {t("signOut")}
        </button>
      </div>
    </aside>
  );
}
