"use client";

import { apiClient } from "@/lib/client-api";
import type { AiTokenReport } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Overview banner for a nearly-spent AI allowance. Renders nothing unless
 * the API says the org is low, so orgs with no included agents never see it.
 */
export function AiTokensAlert() {
  const t = useTranslations("dash.tokens");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [low, setLow] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiClient<AiTokenReport>("/billing/ai-tokens", token)
      .then((r) => setLow(r.low))
      .catch(() => undefined);
  }, [token]);

  if (!low) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)] px-4 py-3">
      <div>
        <div className="text-sm font-semibold text-[var(--color-warning)]">
          ⚠ {t("alertTitle")}
        </div>
        <p className="mt-0.5 text-xs text-[var(--color-warning)]">
          {t("alertBody")}
        </p>
      </div>
      <Link href="/dashboard/billing" className="btn-primary shrink-0 text-sm">
        {t("alertCta")}
      </Link>
    </div>
  );
}
