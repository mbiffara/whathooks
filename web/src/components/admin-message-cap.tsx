"use client";

import { apiClient } from "@/lib/client-api";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Admin control: override an org's monthly message cap (e.g. bump a trusted
 * trial). Empty input clears the override back to plan/trial defaults.
 */
export function AdminMessageCap({
  organizationId,
  override,
}: {
  organizationId: string;
  override: number | null;
}) {
  const { data: session } = useSession();
  const router = useRouter();
  const [value, setValue] = useState(override ? String(override) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const token = session?.accessToken;
    if (!token || busy) return;
    const trimmed = value.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1)) {
      setError("Enter a whole number ≥ 1, or leave empty to clear");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/admin/organizations/${organizationId}/limits`, token, {
        method: "PATCH",
        body: JSON.stringify({ messageLimitOverride: parsed }),
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--color-muted)]">
        Message cap override:
      </span>
      <input
        className="input h-8 w-28 px-2 py-0 text-sm"
        placeholder="default"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        onClick={save}
        disabled={busy}
        className="btn-ghost px-3 py-1 text-xs"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {override != null && (
        <span className="badge bg-[var(--color-warning-bg)] text-[var(--color-warning)]">
          active: {override.toLocaleString()}
        </span>
      )}
      {error && (
        <span className="text-xs text-[var(--color-danger)]">{error}</span>
      )}
    </div>
  );
}
