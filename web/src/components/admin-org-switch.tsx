"use client";

import { apiClient } from "@/lib/client-api";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface SwitchOrgResponse {
  token: string;
  user: {
    organizationId: string | null;
    orgRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  };
}

/**
 * Support mode: platform admins can make any org their active org and open
 * its dashboard (the API allows non-member switching for role ADMIN).
 */
export function AdminOrgSwitch({ organizationId }: { organizationId: string }) {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function switchInto() {
    const token = session?.accessToken;
    if (!token || busy) return;
    setBusy(true);
    try {
      const res = await apiClient<SwitchOrgResponse>(
        "/auth/switch-org",
        token,
        {
          method: "POST",
          body: JSON.stringify({ organizationId }),
        },
      );
      await update({
        accessToken: res.token,
        organizationId: res.user.organizationId,
        orgRole: res.user.orgRole,
      });
      router.push("/dashboard");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={switchInto} disabled={busy} className="btn-ghost">
      {busy ? "Switching…" : "Open dashboard as this org"}
    </button>
  );
}
