"use client";

import { apiClient } from "@/lib/client-api";
import type { WaSession } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * Per-member session access control (team page, MEMBER rows only).
 * Empty selection = access to all sessions.
 */
export function MemberSessionAccess({
  token,
  userId,
  sessionIds,
  sessions,
  onSaved,
}: {
  token: string;
  userId: string;
  sessionIds: string[];
  sessions: WaSession[];
  onSaved: () => void;
}) {
  const t = useTranslations("dash.team");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(sessionIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/organizations/members/${userId}/sessions`, token, {
        method: "PATCH",
        body: JSON.stringify({ sessionIds: selected }),
      });
      setOpen(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const label =
    sessionIds.length === 0
      ? t("allSessionsAccess")
      : t("nSessions", { count: sessionIds.length });

  return (
    <div className="relative">
      <button
        className="btn-ghost px-2 py-1 text-xs"
        onClick={() => {
          setSelected(sessionIds);
          setError(null);
          setOpen((v) => !v);
        }}
      >
        {t("sessionAccess")}: {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-30 w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg">
            <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
              {sessions.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked
                          ? [...prev, s.id]
                          : prev.filter((id) => id !== s.id),
                      )
                    }
                  />
                  <span className="truncate">{s.label}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-[var(--color-muted)]">
              {t("sessionAccessHint")}
            </p>
            {error && (
              <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>
            )}
            <button
              onClick={save}
              disabled={busy}
              className="btn-primary mt-2 w-full py-1.5 text-xs"
            >
              {t("saveAccess")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
