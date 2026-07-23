"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";

/** Hamburger menu for the public header on phones (links hidden at <sm). */
export function MobileMenu() {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);

  const links = [
    { href: "/docs", label: t("docs") },
    { href: "/teams", label: t("forTeams") },
    { href: "/#pricing", label: t("pricing") },
    { href: "/signin", label: t("signIn") },
  ];

  return (
    <div className="sm:hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-lg text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          {open ? (
            <path d="M6 6l12 12M18 6L6 18" />
          ) : (
            <path d="M4 7h16M4 12h16M4 17h16" />
          )}
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-16 z-30 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 pb-4 pt-2 shadow-lg">
            <nav className="flex flex-col">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="mt-2 flex items-center gap-2 border-t border-[var(--color-border)] px-3 pt-3">
              <LocaleSwitcher />
              <ThemeToggle />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
