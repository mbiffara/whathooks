import { GoogleAnalytics } from "@/components/google-analytics";
import { Logo } from "@/components/logo";
import Link from "next/link";
import { InviteActions } from "./invite-actions";

const API_URL = process.env.API_URL ?? "http://localhost:3001/v1";

interface InviteLookup {
  organizationName: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  inviterName: string | null;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expiresAt: string;
}

const TERMINAL_MESSAGES: Record<string, string> = {
  ACCEPTED: "This invitation has already been accepted.",
  REVOKED: "This invitation was revoked. Ask your team for a new one.",
  EXPIRED: "This invitation has expired. Ask your team for a new one.",
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let invite: InviteLookup | null = null;
  try {
    const res = await fetch(`${API_URL}/invitations/${token}`, {
      cache: "no-store",
    });
    if (res.ok) invite = (await res.json()) as InviteLookup;
  } catch {
    // API unreachable — fall through to the not-found message
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <GoogleAnalytics />
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="card flex flex-col gap-4 text-center">
          {!invite ? (
            <>
              <h1 className="text-xl font-bold">Invitation not found</h1>
              <p className="text-sm text-[var(--color-muted)]">
                This invite link is invalid. Ask your team to send a new one.
              </p>
              <Link href="/" className="btn-ghost">
                Go home
              </Link>
            </>
          ) : invite.status !== "PENDING" ? (
            <>
              <h1 className="text-xl font-bold">
                Join {invite.organizationName}
              </h1>
              <p className="text-sm text-[var(--color-muted)]">
                {TERMINAL_MESSAGES[invite.status]}
              </p>
              <Link href="/signin" className="btn-ghost">
                Sign in
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold">
                Join {invite.organizationName}
              </h1>
              <p className="text-sm text-[var(--color-muted)]">
                {invite.inviterName ?? "A teammate"} invited{" "}
                <span className="text-[var(--color-fg)]">{invite.email}</span>{" "}
                to join as{" "}
                <span className="text-[var(--color-fg)]">
                  {invite.role.toLowerCase()}
                </span>
                .
              </p>
              <InviteActions
                token={token}
                orgName={invite.organizationName}
                inviteEmail={invite.email}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
