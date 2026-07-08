"use client";

import { apiClient } from "@/lib/client-api";
import type { OrgMembership } from "@/lib/types";
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

  if (orgs.length <= 1) return null;

  return (
    <div className="px-2 pt-2">
      <label className="px-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
        Organization
      </label>
      <select
        className="input mt-1 w-full text-sm"
        value={activeOrgId ?? ""}
        disabled={switching}
        onChange={(e) => switchTo(e.target.value)}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
