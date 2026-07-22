"use client";

import { apiClient } from "@/lib/client-api";
import type {
  Invitation,
  InvitationCreated,
  OrgRole,
  TeamMember,
} from "@/lib/types";
import { useTranslations } from "next-intl";
import { signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

const ROLE_BADGE: Record<OrgRole, string> = {
  OWNER: "bg-amber-500/15 text-amber-300",
  ADMIN: "bg-sky-500/15 text-sky-300",
  MEMBER: "bg-zinc-500/15 text-zinc-300",
};

export default function TeamPage() {
  const t = useTranslations("dash.team");
  const tc = useTranslations("common");
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
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [token, canManage, tc]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
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
      setError(e instanceof Error ? e.message : t("failedToInvite"));
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
      setError(e instanceof Error ? e.message : t("failedToRegenerate"));
    }
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url);
    setCopied(true);
  }

  async function leave() {
    if (!token || !myUserId) return;
    if (!confirm(t("confirmLeave"))) return;
    try {
      await apiClient(`/organizations/members/${myUserId}`, token, {
        method: "DELETE",
      });
      // Session state (active org, role) is stale now — re-login resolves it.
      signOut({ callbackUrl: "/signin" });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToLeave"));
    }
  }

  const pending = invites.filter((i) => i.status === "PENDING");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-[var(--color-muted)]">{t("subtitle")}</p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {canManage && (
        <form
          onSubmit={invite}
          className="card flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <label className="label">{t("inviteByEmail")}</label>
            <input
              className="input"
              type="email"
              placeholder={t("emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t("role")}</label>
            <select
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value as "ADMIN" | "MEMBER")}
            >
              <option value="MEMBER">{t("roleMemberOption")}</option>
              <option value="ADMIN">{t("roleAdminOption")}</option>
            </select>
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={!email.trim()}
          >
            {t("sendInvite")}
          </button>
        </form>
      )}

      {created && (
        <div className="card border-[var(--color-brand)]/40">
          <p className="text-sm font-medium">
            {created.emailSent
              ? t("inviteEmailSent", { email: created.invitation.email })
              : t("inviteLinkOnly", { email: created.invitation.email })}
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
              {copied ? t("copied") : t("copy")}
            </button>
          </div>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("members")}</h2>
        {loading ? (
          <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
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
                        {t("you")}
                      </span>
                    )}
                    <span className={`ml-2 badge ${ROLE_BADGE[m.role]}`}>
                      {t(`roles.${m.role}`)}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-[var(--color-muted)]">
                    {m.email} ·{" "}
                    {t("joined", {
                      date: new Date(m.joinedAt).toLocaleDateString(),
                    })}
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
                        <option value="MEMBER">{t("memberOpt")}</option>
                        <option value="ADMIN">{t("adminOpt")}</option>
                      </select>
                      <button
                        className="btn-danger"
                        onClick={() => {
                          if (confirm(t("confirmRemove", { email: m.email })))
                            run(() =>
                              apiClient(
                                `/organizations/members/${m.userId}`,
                                token,
                                { method: "DELETE" },
                              ),
                            );
                        }}
                      >
                        {t("remove")}
                      </button>
                      <button
                        className="btn-ghost"
                        onClick={() => {
                          if (confirm(t("confirmTransfer", { email: m.email })))
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
                        {t("makeOwner")}
                      </button>
                    </>
                  )}
                  {isSelf && m.role !== "OWNER" && (
                    <button className="btn-danger" onClick={leave}>
                      {t("leave")}
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
          <h2 className="text-lg font-semibold">{t("pendingInvitations")}</h2>
          {pending.map((i) => (
            <div
              key={i.id}
              className="card flex items-center justify-between gap-4"
            >
              <div>
                <div className="font-medium">
                  {i.email}
                  <span className={`ml-2 badge ${ROLE_BADGE[i.role]}`}>
                    {t(`roles.${i.role}`)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  {t("expires", {
                    date: new Date(i.expiresAt).toLocaleDateString(),
                  })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-ghost" onClick={() => regenerate(i.id)}>
                  {t("newLink")}
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
                  {t("revoke")}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
