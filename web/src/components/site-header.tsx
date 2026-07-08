import Link from "next/link";
import { Logo } from "./logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <nav className="flex items-center gap-2 text-sm">
          <Link
            href="/docs"
            className="px-3 py-2 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            Docs
          </Link>
          <Link
            href="/#pricing"
            className="px-3 py-2 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            Pricing
          </Link>
          <Link
            href="/signin"
            className="px-3 py-2 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            Sign in
          </Link>
          <Link href="/signup" className="btn-primary">
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}
