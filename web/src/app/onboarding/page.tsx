import { Logo } from "@/components/logo";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import Link from "next/link";

/**
 * Setup wizard on its own full-screen route. Deliberately outside
 * /dashboard and /admin: a nested layout cannot drop its parent's chrome,
 * and setup should not compete with a nav the org has nothing in yet.
 * Middleware restricts it to platform admins while it is unfinished.
 */
export default function OnboardingPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <Logo href="/dashboard" />
        <Link
          href="/dashboard"
          className="text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          Skip for now
        </Link>
      </header>

      <div className="mt-10">
        <h1 className="text-3xl font-bold">Let&apos;s get you set up</h1>
        <p className="mt-1 text-[var(--color-muted)]">
          Four steps to your first automated WhatsApp conversation.
        </p>
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          Preview: visible to platform admins only, not yet shown to new
          organizations.
        </p>
      </div>

      <div className="mt-8">
        <OnboardingWizard />
      </div>
    </div>
  );
}
