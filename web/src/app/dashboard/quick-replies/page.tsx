"use client";

import type { QuickReply } from "@/components/messages/types";
import { apiClient } from "@/lib/client-api";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

/** Org-shared canned responses, reusable from the inbox composer (⚡). */
export default function QuickRepliesPage() {
  const t = useTranslations("dash.quickReplies");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [replies, setReplies] = useState<QuickReply[] | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setReplies(await apiClient<QuickReply[]>("/quick-replies", token));
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
      await apiClient("/quick-replies", token, {
        method: "POST",
        body: JSON.stringify({
          text: text.trim(),
          title: title.trim() || undefined,
        }),
      });
      setTitle("");
      setText("");
    });
  }

  function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    void run(async () => {
      await apiClient(`/quick-replies/${editingId}`, token, {
        method: "PATCH",
        body: JSON.stringify({ text: editText.trim(), title: editTitle }),
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

      <form onSubmit={add} className="card flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <input
            className="input w-56"
            maxLength={60}
            placeholder={t("titlePlaceholder")}
              aria-label={t("titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="input min-h-16 flex-1"
            maxLength={4096}
            placeholder={t("textPlaceholder")}
              aria-label={t("textPlaceholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {t("add")}
          </button>
          {error && (
            <span className="text-xs text-[var(--color-danger)]">{error}</span>
          )}
        </div>
      </form>

      {replies === null ? (
        <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
      ) : replies.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {replies.map((q) =>
            editingId === q.id ? (
              <form key={q.id} onSubmit={saveEdit} className="card flex flex-col gap-3">
                <div className="flex flex-wrap gap-3">
                  <input
                    className="input w-56"
                    maxLength={60}
                    placeholder={t("titlePlaceholder")}
              aria-label={t("titlePlaceholder")}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                  <textarea
                    className="input min-h-16 flex-1"
                    maxLength={4096}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy || !editText.trim()}
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
                </div>
              </form>
            ) : (
              <div key={q.id} className="card flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  {q.title && (
                    <div className="text-xs font-semibold text-[var(--color-brand)]">
                      {q.title}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap break-words text-sm text-[var(--color-fg)]">
                    {q.text}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => {
                      setEditingId(q.id);
                      setEditTitle(q.title ?? "");
                      setEditText(q.text);
                    }}
                    className="btn-ghost text-xs"
                  >
                    {tc("edit")}
                  </button>
                  <button
                    onClick={() =>
                      void run(() =>
                        apiClient(`/quick-replies/${q.id}`, token, {
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
