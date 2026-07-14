import Link from "next/link";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-border)] py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 text-sm text-[var(--color-muted)] sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <div className="flex gap-5">
          <Link href="/docs" className="hover:text-[var(--color-fg)]">
            Docs
          </Link>
          <Link href="/signin" className="hover:text-[var(--color-fg)]">
            Sign in
          </Link>
          <Link href="/terms" className="hover:text-[var(--color-fg)]">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-[var(--color-fg)]">
            Privacy
          </Link>
        </div>
        <span>
          © {new Date().getFullYear()} whathooks · powered by{" "}
          <a
            href="https://logicalminds.co"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--color-fg)]"
          >
            logicalminds
          </a>
        </span>
      </div>
    </footer>
  );
}
