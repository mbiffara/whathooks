import { GoogleAnalytics } from "@/components/google-analytics";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — whathooks",
};

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <GoogleAnalytics />
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Last updated: July 8, 2026
        </p>

        <div className="mt-10 flex flex-col gap-8 text-sm leading-relaxed text-[var(--color-muted)] [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[var(--color-fg)]">
          <section>
            <h2>1. The service</h2>
            <p className="mt-2">
              whathooks lets you connect a WhatsApp number you own to our
              platform, receive incoming messages on a webhook you configure,
              and send replies through our REST API and dashboard. By creating
              an account or using the service you agree to these terms.
            </p>
          </section>

          <section>
            <h2>2. Your WhatsApp number and account</h2>
            <p className="mt-2">
              You must own or be authorized to use every phone number you
              connect. Numbers are linked through WhatsApp&apos;s multi-device
              (&ldquo;linked devices&rdquo;) mechanism. whathooks is an
              independent product and is not affiliated with, endorsed by, or
              sponsored by WhatsApp LLC or Meta Platforms, Inc. Your use of
              WhatsApp remains subject to WhatsApp&apos;s own terms of service,
              and you acknowledge that WhatsApp may restrict or ban numbers that
              violate those terms. whathooks cannot prevent, and is not
              responsible for, actions WhatsApp takes against your number.
            </p>
            <p className="mt-2">
              You are responsible for safeguarding your account credentials and
              API keys, and for everything done through them. Organization
              owners and admins control who can access their organization and
              with which role.
            </p>
          </section>

          <section>
            <h2>3. Acceptable use</h2>
            <p className="mt-2">You agree not to use whathooks to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                send spam, bulk unsolicited messages, or messages to people who
                have not agreed to be contacted;
              </li>
              <li>harass, defraud, or deceive others;</li>
              <li>
                send unlawful content or content that infringes third-party
                rights;
              </li>
              <li>
                probe, disrupt, or overload the service, or attempt to access
                other customers&apos; data.
              </li>
            </ul>
            <p className="mt-2">
              We may suspend or terminate accounts that violate this section.
            </p>
          </section>

          <section>
            <h2>4. Messages and data</h2>
            <p className="mt-2">
              Message content passes through and is stored by the service so we
              can deliver it to your webhooks, show it in your dashboard, and
              (if you enable AI agents) generate replies. You retain all rights
              to your content and grant us only the license needed to operate
              the service. See the{" "}
              <Link
                href="/privacy"
                className="text-[var(--color-brand)] hover:underline"
              >
                Privacy Policy
              </Link>{" "}
              for details on what we store and for how long.
            </p>
          </section>

          <section>
            <h2>5. Plans and payment</h2>
            <p className="mt-2">
              Free plans are provided as-is with usage limits. Paid plans renew
              monthly until cancelled; you can cancel at any time and keep
              access until the end of the billing period. We may change prices
              with at least 30 days&apos; notice.
            </p>
          </section>

          <section>
            <h2>6. Availability and changes</h2>
            <p className="mt-2">
              We aim for high availability but the service is provided &ldquo;as
              is&rdquo; without warranties of any kind. Connections depend on
              WhatsApp&apos;s infrastructure and your phone remaining linked,
              which are outside our control. We may modify or discontinue
              features with reasonable notice.
            </p>
          </section>

          <section>
            <h2>7. Limitation of liability</h2>
            <p className="mt-2">
              To the maximum extent permitted by law, whathooks is not liable
              for indirect, incidental, or consequential damages, loss of
              profits, or loss of data. Our total liability for any claim is
              limited to the amount you paid us in the twelve months before the
              claim arose.
            </p>
          </section>

          <section>
            <h2>8. Termination</h2>
            <p className="mt-2">
              You may delete your organization and account at any time. We may
              suspend or terminate accounts for breach of these terms. Upon
              termination we delete your data per the Privacy Policy retention
              rules.
            </p>
          </section>

          <section>
            <h2>9. Changes to these terms</h2>
            <p className="mt-2">
              We may update these terms; material changes will be announced by
              email or in the dashboard at least 14 days before they take
              effect. Continued use after that date constitutes acceptance.
            </p>
          </section>

          <section>
            <h2>10. Contact</h2>
            <p className="mt-2">
              Questions about these terms:{" "}
              <a
                href="mailto:legal@logicalminds.co"
                className="text-[var(--color-brand)] hover:underline"
              >
                legal@logicalminds.co
              </a>
              .
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
