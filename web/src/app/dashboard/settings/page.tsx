"use client";

import { setLocaleCookie } from "@/components/locale-switcher";
import {
  getThemePref,
  setThemePref,
  type ThemePref,
} from "@/components/theme-toggle";
import { apiClient } from "@/lib/client-api";
import {
  DEFAULT_INCOMING_SOUND,
  INCOMING_SOUNDS,
  playIncomingSound,
  toIncomingSound,
  type IncomingSound,
} from "@/lib/incoming-sound";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface Me {
  name: string | null;
  locale: string;
  incomingSound?: string;
}

// Translation key (under dash.settings) for each sound's label.
const SOUND_LABEL_KEYS: Record<
  IncomingSound,
  "soundNone" | "soundChime" | "soundPop" | "soundDing" | "soundDouble"
> = {
  none: "soundNone",
  chime: "soundChime",
  pop: "soundPop",
  ding: "soundDing",
  double: "soundDouble",
};

interface ProfilePatch {
  name?: string;
  locale?: string;
  incomingSound?: IncomingSound;
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
  const [sound, setSound] = useState<IncomingSound>(DEFAULT_INCOMING_SOUND);
  const [soundSaved, setSoundSaved] = useState(false);

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
      setSound(toIncomingSound(me.incomingSound));
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

  async function saveProfile(patch: ProfilePatch): Promise<boolean> {
    if (!token) return false;
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
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function changeSound(next: IncomingSound) {
    const previous = sound;
    setSound(next);
    setSoundSaved(false);
    if (await saveProfile({ incomingSound: next })) {
      setSoundSaved(true);
      setTimeout(() => setSoundSaved(false), 2000);
    } else {
      setSound(previous);
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

      <div className="card flex flex-col gap-4">
        <h2 className="font-semibold">{t("notifications")}</h2>
        <div>
          <label className="label" htmlFor="incoming-sound">
            {t("incomingSound")}
          </label>
          <div className="flex items-center gap-2">
            <select
              id="incoming-sound"
              className="input flex-1"
              value={sound}
              onChange={(e) => changeSound(toIncomingSound(e.target.value))}
              disabled={saving}
            >
              {INCOMING_SOUNDS.map((s) => (
                <option key={s} value={s}>
                  {t(SOUND_LABEL_KEYS[s])}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => playIncomingSound(sound)}
              disabled={sound === "none"}
            >
              {t("soundTest")}
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {t("incomingSoundHint")}
            {soundSaved && (
              <span className="ml-2 text-[var(--color-success)]">
                {t("saved")}
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
