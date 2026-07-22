import { GoogleAnalytics } from "@/components/google-analytics";
import { Logo } from "@/components/logo";
import { getTranslations } from "next-intl/server";
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

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("invite");
  const tNav = await getTranslations("nav");

  let invite: InviteLookup | null = null;
  try {
    const res = await fetch(`${API_URL}/invitations/${token}`, {
      cache: "no-store",
    });
    if (res.ok) invite = (await res.json()) as InviteLookup;
  } catch {
    // API unreachable — fall through to the not-found message
  }

  const terminalMessages: Record<string, string> = {
    ACCEPTED: t("accepted"),
    REVOKED: t("revoked"),
    EXPIRED: t("expired"),
  };

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
              <h1 className="text-xl font-bold">{t("notFound")}</h1>
              <p className="text-sm text-[var(--color-muted)]">
                {t("invalidLink")}
              </p>
              <Link href="/" className="btn-ghost">
                {t("goHome")}
              </Link>
            </>
          ) : invite.status !== "PENDING" ? (
            <>
              <h1 className="text-xl font-bold">
                {t("join", { org: invite.organizationName })}
              </h1>
              <p className="text-sm text-[var(--color-muted)]">
                {terminalMessages[invite.status]}
              </p>
              <Link href="/signin" className="btn-ghost">
                {tNav("signIn")}
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold">
                {t("join", { org: invite.organizationName })}
              </h1>
              <p className="text-sm text-[var(--color-muted)]">
                {t.rich("invitedYou", {
                  inviter: invite.inviterName ?? t("aTeammate"),
                  email: invite.email,
                  role: invite.role.toLowerCase(),
                  hl: (chunks) => (
                    <span className="text-[var(--color-fg)]">{chunks}</span>
                  ),
                })}
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
