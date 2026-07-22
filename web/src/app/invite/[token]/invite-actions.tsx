"use client";

import { apiClient } from "@/lib/client-api";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface AcceptResponse {
  token: string;
  user: {
    organizationId: string | null;
    orgRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  };
}

export function InviteActions({
  token,
  orgName,
  inviteEmail,
}: {
  token: string;
  orgName: string;
  inviteEmail: string;
}) {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  if (status === "loading") {
    return <p className="text-sm text-[var(--color-muted)]">Loading…</p>;
  }

  if (status !== "authenticated") {
    return (
      <div className="flex flex-col gap-2">
        <Link
          href={`/signup?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(inviteEmail)}`}
          className="btn-primary"
        >
          Create account
        </Link>
        <Link
          href={`/signin?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`}
          className="btn-ghost"
        >
          I already have an account
        </Link>
      </div>
    );
  }

  const mismatch =
    session.user?.email &&
    session.user.email.toLowerCase() !== inviteEmail.toLowerCase();

  async function join() {
    setError(null);
    setJoining(true);
    try {
      const res = await apiClient<AcceptResponse>(
        `/invitations/${token}/accept`,
        session?.accessToken,
        { method: "POST" },
      );
      await update({
        accessToken: res.token,
        organizationId: res.user.organizationId,
        orgRole: res.user.orgRole,
      });
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join");
      setJoining(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {mismatch && (
        <p className="rounded-lg bg-[var(--color-warning-bg)] p-3 text-sm text-[var(--color-warning)]">
          This invitation was sent to {inviteEmail}, but you are signed in as{" "}
          {session.user?.email}. You can still join {orgName} with this
          account.
        </p>
      )}
      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      <button className="btn-primary" onClick={join} disabled={joining}>
        {joining ? "Joining…" : `Join ${orgName}`}
      </button>
    </div>
  );
}
