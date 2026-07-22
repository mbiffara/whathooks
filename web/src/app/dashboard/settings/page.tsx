"use client";

import { setLocaleCookie } from "@/components/locale-switcher";
import {
  getThemePref,
  setThemePref,
  type ThemePref,
} from "@/components/theme-toggle";
import { apiClient } from "@/lib/client-api";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface Me {
  name: string | null;
  locale: string;
}

export default function SettingsPage() {
  const t = useTranslations("dash.settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [name, setName] = useState("");
  const [theme, setTheme] = useState<ThemePref>("system");

  useEffect(() => {
    setTheme(getThemePref());
  }, []);

  function changeTheme(next: ThemePref) {
    setThemePref(next);
    setTheme(next);
  }
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const me = await apiClient<Me>("/auth/me", token);
      setName(me.name ?? "");
      // Account setting wins: align the cookie with the stored preference.
      if (me.locale && me.locale !== locale) {
        setLocaleCookie(me.locale);
        router.refresh();
      }
    } catch {
      /* non-fatal */
    }
  }, [token, locale, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProfile(patch: { name?: string; locale?: string }) {
    if (!token) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiClient("/auth/profile", token, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (patch.locale) {
        setLocaleCookie(patch.locale);
        router.refresh();
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-[var(--color-muted)]">{t("subtitle")}</p>
      </div>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      <div className="card flex flex-col gap-4">
        <div>
          <label className="label">{t("language")}</label>
          <select
            className="input"
            value={locale}
            onChange={(e) => saveProfile({ locale: e.target.value })}
            disabled={saving}
          >
            <option value="en">{t("english")}</option>
            <option value="es">{t("spanish")}</option>
          </select>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {t("languageHint")}
          </p>
        </div>
        <div>
          <label className="label">{t("theme")}</label>
          <select
            className="input"
            value={theme}
            onChange={(e) => changeTheme(e.target.value as ThemePref)}
          >
            <option value="system">{t("themeSystem")}</option>
            <option value="light">{t("themeLight")}</option>
            <option value="dark">{t("themeDark")}</option>
          </select>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {t("themeHint")}
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveProfile({ name });
          }}
          className="flex items-end gap-2"
        >
          <div className="flex-1">
            <label className="label">{t("name")}</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? tc("saving") : saved ? t("saved") : tc("save")}
          </button>
        </form>
      </div>
    </div>
  );
}
