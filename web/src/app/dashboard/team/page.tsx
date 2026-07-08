"use client";

import { apiClient } from "@/lib/client-api";
import type {
  Invitation,
  InvitationCreated,
  OrgRole,
  TeamMember,
} from "@/lib/types";
import { signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

const ROLE_BADGE: Record<OrgRole, string> = {
  OWNER: "bg-amber-500/15 text-amber-300",
  ADMIN: "bg-sky-500/15 text-sky-300",
  MEMBER: "bg-zinc-500/15 text-zinc-300",
};

export default function TeamPage() {
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const myUserId = auth?.user?.id;
  const orgRole = auth?.user?.orgRole;
  const canManage = orgRole === "OWNER" || orgRole === "ADMIN";
  const isOwner = orgRole === "OWNER";

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // invite form
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const requests: Promise<unknown>[] = [
        apiClient<TeamMember[]>("/organizations/members", token),
      ];
      if (canManage) {
        requests.push(
          apiClient<Invitation[]>("/organizations/invitations", token),
        );
      }
      const [m, i] = await Promise.all(requests);
      setMembers(m as TeamMember[]);
      if (i) setInvites(i as Invitation[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token, canManage]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !email.trim()) return;
    setError(null);
    setCreated(null);
    setCopied(false);
    try {
      const res = await apiClient<InvitationCreated>(
        "/organizations/invitations",
        token,
        {
          method: "POST",
          body: JSON.stringify({ email: email.trim(), role }),
        },
      );
      setCreated(res);
      setEmail("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to invite");
    }
  }

  async function regenerate(id: string) {
    if (!token) return;
    setError(null);
    setCopied(false);
    try {
      const res = await apiClient<InvitationCreated>(
        `/organizations/invitations/${id}/regenerate`,
        token,
        { method: "POST" },
      );
      setCreated(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to regenerate");
    }
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url);
    setCopied(true);
  }

  async function leave() {
    if (!token || !myUserId) return;
    if (!confirm("Leave this organization?")) return;
    try {
      await apiClient(`/organizations/members/${myUserId}`, token, {
        method: "DELETE",
      });
      // Session state (active org, role) is stale now — re-login resolves it.
      signOut({ callbackUrl: "/signin" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to leave");
    }
  }

  const pending = invites.filter((i) => i.status === "PENDING");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Team</h1>
        <p className="text-sm text-[var(--color-muted)]">
          People with access to this organization&apos;s WhatsApp sessions,
          messages and agents.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {canManage && (
        <form
          onSubmit={invite}
          className="card flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <label className="label">Invite by email</label>
            <input
              className="input"
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Role</label>
            <select
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value as "ADMIN" | "MEMBER")}
            >
              <option value="MEMBER">Member — operate & message</option>
              <option value="ADMIN">Admin — manage everything</option>
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={!email.trim()}>
            Send invite
          </button>
        </form>
      )}

      {created && (
        <div className="card border-[var(--color-brand)]/40">
          <p className="text-sm font-medium">
            Invitation for {created.invitation.email} —{" "}
            {created.emailSent
              ? "email sent. You can also share this link directly:"
              : "email is not configured, share this link (shown once):"}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="block flex-1 break-all rounded-lg bg-[var(--color-surface-2)] p-3 font-mono text-sm text-[var(--color-accent)]">
              {created.inviteUrl}
            </code>
            <button
              type="button"
              className="btn-primary shrink-0"
              onClick={() => copyLink(created.inviteUrl)}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Members</h2>
        {loading ? (
          <p className="text-sm text-[var(--color-muted)]">Loading…</p>
        ) : (
          members.map((m) => {
            const isSelf = m.userId === myUserId;
            return (
              <div
                key={m.userId}
                className="card flex items-center justify-between gap-4"
              >
                <div>
                  <div className="font-medium">
                    {m.name ?? m.email}
                    {isSelf && (
                      <span className="ml-2 text-xs text-[var(--color-muted)]">
                        (you)
                      </span>
                    )}
                    <span className={`ml-2 badge ${ROLE_BADGE[m.role]}`}>
                      {m.role.toLowerCase()}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-[var(--color-muted)]">
                    {m.email} · joined{" "}
                    {new Date(m.joinedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isOwner && !isSelf && m.role !== "OWNER" && (
                    <>
                      <select
                        className="input text-sm"
                        value={m.role}
                        onChange={(e) =>
                          run(() =>
                            apiClient(
                              `/organizations/members/${m.userId}`,
                              token,
                              {
                                method: "PATCH",
                                body: JSON.stringify({ role: e.target.value }),
                              },
                            ),
                          )
                        }
                      >
                        <option value="MEMBER">Member</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                      <button
                        className="btn-danger"
                        onClick={() => {
                          if (confirm(`Remove ${m.email} from the team?`))
                            run(() =>
                              apiClient(
                                `/organizations/members/${m.userId}`,
                                token,
                                { method: "DELETE" },
                              ),
                            );
                        }}
                      >
                        Remove
                      </button>
                      <button
                        className="btn-ghost"
                        onClick={() => {
                          if (
                            confirm(
                              `Transfer ownership to ${m.email}? You will become an admin.`,
                            )
                          )
                            run(() =>
                              apiClient(
                                "/organizations/transfer-ownership",
                                token,
                                {
                                  method: "POST",
                                  body: JSON.stringify({ userId: m.userId }),
                                },
                              ),
                            );
                        }}
                      >
                        Make owner
                      </button>
                    </>
                  )}
                  {isSelf && m.role !== "OWNER" && (
                    <button className="btn-danger" onClick={leave}>
                      Leave
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </section>

      {canManage && pending.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Pending invitations</h2>
          {pending.map((i) => (
            <div
              key={i.id}
              className="card flex items-center justify-between gap-4"
            >
              <div>
                <div className="font-medium">
                  {i.email}
                  <span className={`ml-2 badge ${ROLE_BADGE[i.role]}`}>
                    {i.role.toLowerCase()}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  Expires {new Date(i.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost"
                  onClick={() => regenerate(i.id)}
                >
                  New link
                </button>
                <button
                  className="btn-danger"
                  onClick={() =>
                    run(() =>
                      apiClient(`/organizations/invitations/${i.id}`, token, {
                        method: "DELETE",
                      }),
                    )
                  }
                >
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
