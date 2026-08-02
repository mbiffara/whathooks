"use client";

import { apiClient } from "@/lib/client-api";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface HumanAgent {
  id: string;
  name: string;
  phoneNumber: string;
  links: number;
}

/** Org directory of the humans who answer chats (vs. AI agents). */
export default function HumanAgentsPage() {
  const t = useTranslations("dash.humanAgents");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [agents, setAgents] = useState<HumanAgent[] | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setAgents(await apiClient<HumanAgent[]>("/human-agents", token));
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    }
  }, [token, tc]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      await apiClient("/human-agents", token, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          phoneNumber: phone.trim(),
        }),
      });
      setName("");
      setPhone("");
    });
  }

  function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    void run(async () => {
      await apiClient(`/human-agents/${editingId}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim(),
          phoneNumber: editPhone.trim(),
        }),
      });
      setEditingId(null);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {t.rich("subtitle", {
            mirror: (c) => (
              <Link
                href="/dashboard/mirror"
                className="text-[var(--color-brand)] hover:underline"
              >
                {c}
              </Link>
            ),
          })}
        </p>
      </div>

      <form onSubmit={add} className="card flex flex-wrap items-end gap-3">
        <div className="min-w-44 flex-1">
          <label className="label">{t("name")}</label>
          <input
            className="input"
            placeholder="Juan Pérez"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="min-w-52 flex-1">
          <label className="label">{t("phone")}</label>
          <input
            className="input"
            placeholder="5491155551234"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          {t("add")}
        </button>
      </form>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      {agents === null ? (
        <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
      ) : agents.length === 0 ? (
        <div className="card text-sm text-[var(--color-muted)]">
          {t("empty")}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {agents.map((a) =>
            editingId === a.id ? (
              <form
                key={a.id}
                onSubmit={saveEdit}
                className="card flex flex-wrap items-end gap-3"
              >
                <div className="min-w-44 flex-1">
                  <label className="label">{t("name")}</label>
                  <input
                    className="input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                  />
                </div>
                <div className="min-w-52 flex-1">
                  <label className="label">{t("phone")}</label>
                  <input
                    className="input"
                    inputMode="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" disabled={busy} className="btn-primary">
                  {tc("save")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="btn-ghost"
                >
                  {tc("cancel")}
                </button>
              </form>
            ) : (
              <div key={a.id} className="card flex items-center gap-4">
                <div className="min-w-0">
                  <div className="font-medium">{a.name}</div>
                  <div className="font-mono text-xs text-[var(--color-muted)]">
                    +{a.phoneNumber}
                  </div>
                </div>
                {a.links > 0 && (
                  <span className="badge bg-[var(--color-chip)] text-[var(--color-muted)] text-[10px]">
                    {t("inUse", { count: a.links })}
                  </span>
                )}
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => {
                      setEditingId(a.id);
                      setEditName(a.name);
                      setEditPhone(a.phoneNumber);
                    }}
                    className="btn-ghost text-xs"
                  >
                    {tc("edit")}
                  </button>
                  <button
                    onClick={() =>
                      void run(() =>
                        apiClient(`/human-agents/${a.id}`, token, {
                          method: "DELETE",
                        }),
                      )
                    }
                    disabled={busy}
                    className="btn-danger text-xs"
                  >
                    {tc("delete")}
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
