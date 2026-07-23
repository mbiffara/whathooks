"use client";

import { Logo } from "@/components/logo";
import { OrgSwitcher } from "@/components/org-switcher";
import { useTranslations } from "next-intl";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type IconName =
  | "overview"
  | "messages"
  | "sessions"
  | "agents"
  | "webhooks"
  | "apiKeys"
  | "logs"
  | "team"
  | "billing"
  | "settings"
  | "admin"
  | "signOut";

/** Minimal stroke icons (24 viewBox), sized by the parent via width/height. */
function NavIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    messages: (
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    ),
    sessions: (
      <>
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" />
      </>
    ),
    agents: (
      <>
        <rect x="4" y="7" width="16" height="12" rx="2" />
        <path d="M12 7V3M8 12h.01M16 12h.01M9 16h6" />
      </>
    ),
    webhooks: <path d="M13 2 3 14h8l-1 8 11-13h-9l1-7z" />,
    apiKeys: (
      <>
        <circle cx="7.5" cy="15.5" r="3.5" />
        <path d="M10.5 12.5 21 2M15 8l3 3" />
      </>
    ),
    logs: <path d="M4 6h.01M8 6h12M4 12h.01M8 12h12M4 18h.01M8 18h12" />,
    team: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M17.5 14.5a6 6 0 0 1 3.5 5.5" />
      </>
    ),
    billing: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
      </>
    ),
    admin: <path d="M12 2l8 4v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-4z" />,
    signOut: (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5-5-5M21 12H9" />
      </>
    ),
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}

interface NavLink {
  href: string;
  key: IconName;
  exact?: boolean;
}

/** Grouped nav: first group has no header. Group keys map to dash.nav.groups. */
const GROUPS: { key: string | null; links: NavLink[] }[] = [
  {
    key: null,
    links: [
      { href: "/dashboard", key: "overview", exact: true },
      { href: "/dashboard/messages", key: "messages" },
      { href: "/dashboard/sessions", key: "sessions" },
    ],
  },
  {
    key: "automation",
    links: [
      { href: "/dashboard/agents", key: "agents" },
      { href: "/dashboard/webhooks", key: "webhooks" },
    ],
  },
  {
    key: "developer",
    links: [
      { href: "/dashboard/api-keys", key: "apiKeys" },
      { href: "/dashboard/logs", key: "logs" },
    ],
  },
  {
    key: "organization",
    links: [
      { href: "/dashboard/team", key: "team" },
      { href: "/dashboard/billing", key: "billing" },
      { href: "/dashboard/settings", key: "settings" },
    ],
  },
];

const COLLAPSE_KEY = "NAV_COLLAPSED";

export function DashboardNav() {
  const t = useTranslations("dash.nav");
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // localStorage isn't available during SSR — restore the preference on mount.
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  function toggleCollapsed() {
    setCollapsed((v) => {
      localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1");
      return !v;
    });
  }

  function isActive(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  // Phones always get the icon rail (pure CSS via the wrapper below — no JS,
  // so it can't be lost to a hydration or matchMedia quirk).
  const rail = (
    <aside className="flex w-14 shrink-0 flex-col items-center border-r border-[var(--color-border)] bg-[var(--color-surface)] py-4">
      <Link
        href="/dashboard"
        className="grid h-8 w-8 place-items-center"
        aria-label={t("overview")}
      >
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-brand)] text-sm font-bold text-[var(--color-on-brand)]">
          w
        </span>
      </Link>
      <button
        onClick={toggleCollapsed}
        aria-label={t("expand")}
        title={t("expand")}
        className="mt-2 hidden h-8 w-8 place-items-center rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] md:grid"
      >
        »
      </button>
      <button
        onClick={() => setDrawerOpen(true)}
        aria-label={t("expand")}
        className="mt-2 grid h-8 w-8 place-items-center rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] md:hidden"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <nav className="mt-3 flex flex-1 flex-col items-center gap-1 overflow-y-auto">
        {GROUPS.map((group, gi) => (
          <div
            key={group.key ?? "main"}
            className={`flex flex-col items-center gap-1 ${
              gi > 0 ? "mt-1 border-t border-[var(--color-border)] pt-2" : ""
            }`}
          >
            {group.links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                title={t(l.key)}
                aria-label={t(l.key)}
                className={`grid h-9 w-9 place-items-center rounded-lg transition-colors ${
                  isActive(l.href, l.exact)
                    ? "bg-[var(--color-surface-2)] text-[var(--color-fg)]"
                    : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                }`}
              >
                <NavIcon name={l.key} />
              </Link>
            ))}
          </div>
        ))}
        {isAdmin && (
          <Link
            href="/admin"
            title={t("admin")}
            aria-label={t("admin")}
            className={`mt-1 grid h-9 w-9 place-items-center rounded-lg border-t border-[var(--color-border)] pt-1 transition-colors ${
              pathname.startsWith("/admin")
                ? "text-[var(--color-brand)]"
                : "text-[var(--color-brand)]/70 hover:text-[var(--color-brand)]"
            }`}
          >
            <NavIcon name="admin" />
          </Link>
        )}
      </nav>
      <button
        onClick={() => signOut({ callbackUrl: "/" })}
        title={t("signOut")}
        aria-label={t("signOut")}
        className="mt-2 grid h-9 w-9 place-items-center rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
      >
        <NavIcon name="signOut" />
      </button>
    </aside>
  );

  const expanded = (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between px-2 py-2">
        <Logo href="/dashboard" />
        <button
          onClick={toggleCollapsed}
          aria-label={t("collapse")}
          title={t("collapse")}
          className="grid h-7 w-7 place-items-center rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
        >
          «
        </button>
      </div>
      <OrgSwitcher />
      <nav className="mt-4 flex flex-1 flex-col gap-1 overflow-y-auto">
        {GROUPS.map((group) => (
          <div key={group.key ?? "main"} className="flex flex-col gap-1">
            {group.key && (
              <div className="mt-3 px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                {t(`groups.${group.key}`)}
              </div>
            )}
            {group.links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive(l.href, l.exact)
                    ? "bg-[var(--color-surface-2)] font-medium text-[var(--color-fg)]"
                    : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                }`}
              >
                <NavIcon name={l.key} />
                {t(l.key)}
              </Link>
            ))}
          </div>
        ))}
        {isAdmin && (
          <Link
            href="/admin"
            className={`mt-3 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname.startsWith("/admin")
                ? "bg-[var(--color-surface-2)] font-medium text-[var(--color-brand)]"
                : "text-[var(--color-brand)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            <NavIcon name="admin" />
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
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
        >
          <NavIcon name="signOut" />
          {t("signOut")}
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Phones: always the rail. md+: whichever the user chose. */}
      <div className="contents md:hidden">{rail}</div>
      <div className="hidden md:contents">{collapsed ? rail : expanded}</div>
      {/* Phone drawer: the full labeled menu over the content. Any tap on a
          link or button inside closes it. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw]"
            onClickCapture={(e) => {
              if ((e.target as HTMLElement).closest("a, button")) {
                setDrawerOpen(false);
              }
            }}
          >
            {expanded}
          </div>
        </div>
      )}
    </>
  );
}
