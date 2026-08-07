"use client";

import { NewSessionDialog } from "@/components/new-session-dialog";
import { UpgradeModal } from "@/components/upgrade-modal";
import { apiClient } from "@/lib/client-api";
import type { Subscription } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

/**
 * The overview's primary action. A client island so the server-rendered
 * page can still open the session dialog instead of bouncing to the
 * sessions list and making the user find the form.
 */
export function ConnectNumberButton() {
  const t = useTranslations("dash.overview");
  const ts = useTranslations("dash.sessions");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [open, setOpen] = useState(false);
  const [needsPlan, setNeedsPlan] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Best-effort: the API's 403 stays the fallback if this never resolves.
  useEffect(() => {
    if (!token) return;
    apiClient<Subscription>("/billing/subscription", token)
      .then((sub) => setNeedsPlan(!sub.subscribed))
      .catch(() => undefined);
  }, [token]);

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>
        {t("connectNumber")}
      </button>
      <NewSessionDialog
        open={open}
        onClose={() => setOpen(false)}
        token={token}
        needsPlan={needsPlan}
        onSubscriptionRequired={() => setShowUpgrade(true)}
      />
      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        action={ts("upgradeAction")}
      />
    </>
  );
}
