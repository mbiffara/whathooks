"use client";

import { apiClient } from "@/lib/client-api";
import type { OrgMembership } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface SwitchOrgResponse {
  token: string;
  user: {
    organizationId: string | null;
    orgRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  };
}

export function OrgSwitcher() {
  const t = useTranslations("dash.orgSwitcher");
  const { data: session, update } = useSession();
  const router = useRouter();
  const token = session?.accessToken;
  const activeOrgId = session?.user?.organizationId;
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setOrgs(await apiClient<OrgMembership[]>("/organizations", token));
    } catch {
      // nav should never break because the switcher can't load
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function switchTo(organizationId: string) {
    if (!token || organizationId === activeOrgId) return;
    setSwitching(true);
    try {
      const res = await apiClient<SwitchOrgResponse>(
        "/auth/switch-org",
        token,
        { method: "POST", body: JSON.stringify({ organizationId }) },
      );
      await update({
        accessToken: res.token,
        organizationId: res.user.organizationId,
        orgRole: res.user.orgRole,
      });
      router.refresh();
    } finally {
      setSwitching(false);
    }
  }

  // Only meaningful once the list has loaded — while empty we can't tell a
  // foreign org from a slow fetch.
  const inForeignOrg =
    orgs.length > 0 &&
    Boolean(activeOrgId) &&
    !orgs.some((o) => o.id === activeOrgId);
  // Hide when there's nothing to switch to — unless a platform admin is
  // parked in a foreign org (support mode) and needs a way back home.
  if (orgs.length <= 1 && !inForeignOrg) return null;

  return (
    <div className="px-2 pt-2">
      <label className="px-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
        {t("organization")}
      </label>
      <select
        className="input mt-1 w-full text-sm"
        value={activeOrgId ?? ""}
        disabled={switching}
        onChange={(e) => switchTo(e.target.value)}
      >
        {inForeignOrg && (
          <option value={activeOrgId ?? ""} disabled>
            (support) {activeOrgId}
          </option>
        )}
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
