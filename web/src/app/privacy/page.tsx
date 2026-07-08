import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — whathooks",
};

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Last updated: July 8, 2026
        </p>

        <div className="mt-10 flex flex-col gap-8 text-sm leading-relaxed text-[var(--color-muted)] [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[var(--color-fg)]">
          <section>
            <h2>1. What we collect</h2>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                <span className="font-medium text-[var(--color-fg)]">
                  Account data
                </span>{" "}
                — your name, email address, and a hash of your password (we
                never store passwords in plain text).
              </li>
              <li>
                <span className="font-medium text-[var(--color-fg)]">
                  WhatsApp session data
                </span>{" "}
                — the phone number you link and the encrypted credentials
                needed to keep the connection alive.
              </li>
              <li>
                <span className="font-medium text-[var(--color-fg)]">
                  Messages and media
                </span>{" "}
                — the content of conversations flowing through your connected
                numbers, stored so we can deliver webhooks, show conversation
                history in your dashboard, and power features you enable.
              </li>
              <li>
                <span className="font-medium text-[var(--color-fg)]">
                  Configuration
                </span>{" "}
                — webhook URLs, API key hashes, team memberships and roles, and
                delivery logs.
              </li>
            </ul>
          </section>

          <section>
            <h2>2. How we use it</h2>
            <p className="mt-2">
              We use this data only to operate the service: routing messages to
              your webhooks, sending your replies, displaying dashboards,
              securing accounts, and sending transactional email such as team
              invitations. We do not sell your data or use message content for
              advertising.
            </p>
          </section>

          <section>
            <h2>3. AI agents</h2>
            <p className="mt-2">
              If you enable an AI agent on a session, the relevant conversation
              messages are sent to the model provider you configured (e.g.
              Anthropic or OpenAI) using your own API key, solely to generate
              replies. Provider handling of that data is governed by the
              provider&apos;s own terms. Agents are off by default.
            </p>
          </section>

          <section>
            <h2>4. Sharing</h2>
            <p className="mt-2">
              We share data only with processors needed to run the service:
              cloud hosting for infrastructure and storage, and an email
              delivery provider for transactional email (such as invitation
              emails). Each receives only what it needs. We disclose data to
              authorities only when legally required.
            </p>
          </section>

          <section>
            <h2>5. Retention and deletion</h2>
            <p className="mt-2">
              Data is retained while your organization is active. Deleting a
              WhatsApp session deletes its credentials; deleting your
              organization deletes its sessions, conversations, messages,
              media, webhooks, API keys, and team data. Residual copies in
              backups are purged on the backup rotation schedule.
            </p>
          </section>

          <section>
            <h2>6. Security</h2>
            <p className="mt-2">
              Passwords are hashed with argon2; API keys and invitation tokens
              are stored only as SHA-256 hashes; agent provider keys are
              encrypted at rest with AES-256-GCM; webhook deliveries are signed
              with HMAC-SHA256 so you can verify their origin. Access to
              production systems is restricted to authorized personnel.
            </p>
          </section>

          <section>
            <h2>7. Your rights</h2>
            <p className="mt-2">
              You can access and update your account data in the dashboard, and
              export or delete your data by deleting resources or your
              organization. Depending on your jurisdiction you may have
              additional rights (access, rectification, erasure, portability) —
              contact us to exercise them.
            </p>
          </section>

          <section>
            <h2>8. Messages belong to conversations you control</h2>
            <p className="mt-2">
              You are the controller of conversations flowing through the
              numbers you connect. Ensure you have a lawful basis to process
              your contacts&apos; messages through whathooks, and inform them
              where required.
            </p>
          </section>

          <section>
            <h2>9. Changes and contact</h2>
            <p className="mt-2">
              We will announce material changes to this policy by email or in
              the dashboard. Questions:{" "}
              <a
                href="mailto:privacy@whathooks.com"
                className="text-[var(--color-brand)] hover:underline"
              >
                privacy@whathooks.com
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
