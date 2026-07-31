"use client";

import { API_URL } from "@/lib/client-api";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

interface ShareView {
  label: string;
  organization: string;
  status: string;
  qrDataUrl: string | null;
}

/**
 * Public QR page: anyone with the share link can scan the QR to connect the
 * WhatsApp number — no whathooks account needed. Polls while waiting; the API
 * wakes the session's socket so a fresh QR appears even hours later.
 */
export function ConnectClient({ token }: { token: string }) {
  const t = useTranslations("connect");
  const [view, setView] = useState<ShareView | null>(null);
  const [invalid, setInvalid] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Public visitors have no saved theme — default this page to light (it's
  // mostly a white QR code; dark chrome around it looks broken). An explicit
  // THEME choice from a logged-in whathooks user is respected.
  useEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute("data-theme")) return;
    root.setAttribute("data-theme", "light");
    return () => root.removeAttribute("data-theme");
  }, []);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`${API_URL}/public/connect/${token}`);
        if (res.status === 404) {
          if (active) setInvalid(true);
          return; // stop polling — the link is dead
        }
        if (res.ok && active) setView(await res.json());
      } catch {
        /* transient network error — keep polling */
      }
      if (active) timer.current = setTimeout(tick, 2500);
    };
    tick();
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [token]);

  const connected = view?.status === "CONNECTED";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-4">
      <div className="card w-full max-w-md text-center">
        <div className="mb-4 text-lg font-bold text-[var(--color-brand)]">
          whathooks
        </div>
        {invalid ? (
          <>
            <h1 className="text-xl font-semibold">{t("expiredTitle")}</h1>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              {t("expiredBody")}
            </p>
          </>
        ) : connected ? (
          <>
            <div className="mb-2 text-4xl">✅</div>
            <h1 className="text-xl font-semibold">{t("connectedTitle")}</h1>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              {t("connectedBody", { label: view!.label })}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">
              {view
                ? t("invitedTitle", { org: view.organization })
                : t("loadingTitle")}
            </h1>
            {view && (
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                {t("sessionLine", { label: view.label })}
              </p>
            )}
            <ol className="mx-auto mt-3 max-w-xs list-decimal space-y-1 pl-5 text-left text-sm text-[var(--color-muted)]">
              <li>{t("step1")}</li>
              <li>{t("step2")}</li>
              <li>{t("step3")}</li>
            </ol>
            <div className="mt-5 flex min-h-80 items-center justify-center">
              {view?.qrDataUrl ? (
                <Image
                  src={view.qrDataUrl}
                  alt={t("qrAlt")}
                  width={320}
                  height={320}
                  unoptimized
                  className="rounded-xl bg-white p-2"
                />
              ) : (
                <p className="text-sm text-[var(--color-muted)]">
                  {t("waitingQr")}
                </p>
              )}
            </div>
            <p className="mt-3 text-xs text-[var(--color-muted)]">
              {t("qrRefreshes")}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
