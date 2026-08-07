"use client";

import { apiClient } from "@/lib/client-api";
import type { WaSession } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

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
  // Fixed-position anchor: the panel must escape the members table's
  // overflow-x-auto container, which clips absolutely-positioned children.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [selected, setSelected] = useState<string[]>(sessionIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

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
    sessionIds.length === 0 ? t("allSessionsShort") : String(sessionIds.length);

  return (
    <div className="relative">
      <button
        className="btn-ghost whitespace-nowrap px-2 py-1 text-xs"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          sessionIds.length === 0
            ? t("allSessionsAccess")
            : t("nSessions", { count: sessionIds.length })
        }
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor({
            top: r.bottom + 4,
            left: Math.max(8, Math.min(r.left, window.innerWidth - 264)),
          });
          setSelected(sessionIds);
          setError(null);
          setOpen((v) => !v);
        }}
      >
        {t("sessionAccess")}: {label}
      </button>
      {open && anchor && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="fixed z-30 w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg"
            style={{ top: anchor.top, left: anchor.left }}
          >
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
