import { OnboardingWizard } from "@/components/onboarding-wizard";

/**
 * Setup wizard, parked under /admin while it is unfinished: middleware
 * already redirects non-platform-admins away from /admin/*, so no extra
 * guard is needed. Moving it to /dashboard/onboarding later is a file move
 * plus a nav entry.
 */
export default function OnboardingPreviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Onboarding (preview)</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Work in progress. Visible to platform admins only; not linked from the
          nav and not yet shown to new organizations.
        </p>
      </div>
      <OnboardingWizard />
    </div>
  );
}
