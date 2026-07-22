"use client";

import { setLocaleCookie } from "@/components/locale-switcher";
import { apiClient } from "@/lib/client-api";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Aligns the locale cookie with the account's stored language preference —
 * the account setting wins over whatever the visitor cookie says. Mounted in
 * the dashboard layout so signing in on any device lands in your language.
 */
export function LocaleSync() {
  const locale = useLocale();
  const router = useRouter();
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const checked = useRef(false);

  useEffect(() => {
    if (!token || checked.current) return;
    checked.current = true;
    apiClient<{ locale?: string }>("/auth/me", token)
      .then((me) => {
        if (me.locale && me.locale !== locale) {
          setLocaleCookie(me.locale);
          router.refresh();
        }
      })
      .catch(() => {});
  }, [token, locale, router]);

  return null;
}
