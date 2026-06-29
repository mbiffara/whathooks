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
          <a
            href="https://github.com/whiskeysockets/Baileys"
            className="hover:text-[var(--color-fg)]"
            target="_blank"
            rel="noreferrer"
          >
            Powered by Baileys
          </a>
        </div>
        <span>© {new Date().getFullYear()} whathooks</span>
      </div>
    </footer>
  );
}
