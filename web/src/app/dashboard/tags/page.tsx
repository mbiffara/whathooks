"use client";

import type { ConversationTag } from "@/components/messages/types";
import { apiClient } from "@/lib/client-api";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

const DEFAULT_COLOR = "#25d366";

/** Org-shared conversation tags, used by the inbox and the tag flow node. */
export default function TagsPage() {
  const t = useTranslations("dash.tags");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [tags, setTags] = useState<ConversationTag[] | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(DEFAULT_COLOR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setTags(await apiClient<ConversationTag[]>("/tags", token));
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
      await apiClient("/tags", token, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), color }),
      });
      setName("");
      setColor(DEFAULT_COLOR);
    });
  }

  function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    void run(async () => {
      await apiClient(`/tags/${editingId}`, token, {
        method: "PATCH",
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      });
      setEditingId(null);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-[var(--color-muted)]">{t("subtitle")}</p>
      </div>

      <form onSubmit={add} className="card flex flex-wrap items-center gap-3">
        <input
          className="input w-64"
          maxLength={30}
          placeholder={t("namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="color"
          aria-label={t("color")}
          className="h-9 w-12 cursor-pointer rounded-lg border border-[var(--color-border)] bg-transparent"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {t("add")}
        </button>
        {error && (
          <span className="text-xs text-[var(--color-danger)]">{error}</span>
        )}
      </form>

      {tags === null ? (
        <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
      ) : tags.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {tags.map((tg) =>
            editingId === tg.id ? (
              <form
                key={tg.id}
                onSubmit={saveEdit}
                className="card flex flex-wrap items-center gap-3"
              >
                <input
                  className="input w-64"
                  maxLength={30}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <input
                  type="color"
                  aria-label={t("color")}
                  className="h-9 w-12 cursor-pointer rounded-lg border border-[var(--color-border)] bg-transparent"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={busy || !editName.trim()}
                  className="btn-primary text-xs disabled:opacity-50"
                >
                  {tc("save")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="btn-ghost text-xs"
                >
                  {tc("cancel")}
                </button>
              </form>
            ) : (
              <div key={tg.id} className="card flex items-center gap-3">
                <span
                  className="rounded-full border px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    color: tg.color,
                    borderColor: tg.color,
                    backgroundColor: `${tg.color}1a`,
                  }}
                >
                  {tg.name}
                </span>
                <div className="ml-auto flex shrink-0 gap-2">
                  <button
                    onClick={() => {
                      setEditingId(tg.id);
                      setEditName(tg.name);
                      setEditColor(tg.color);
                    }}
                    className="btn-ghost text-xs"
                  >
                    {tc("edit")}
                  </button>
                  <button
                    onClick={() =>
                      void run(() =>
                        apiClient(`/tags/${tg.id}`, token, {
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
