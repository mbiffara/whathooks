"use client";

import { API_URL, apiClient } from "@/lib/client-api";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

interface LibraryItem {
  id: string;
  name: string;
  description: string | null;
  mimeType: string;
  fileName: string;
  size: number;
  url: string;
  updatedAt: string;
}

const MAX_ITEMS = 50;
const ACCEPT =
  "image/*,video/*,audio/*,application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function kindIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.startsWith("video/")) return "🎬";
  if (mimeType.startsWith("audio/")) return "🎧";
  if (mimeType === "application/pdf") return "📄";
  return "📎";
}

/**
 * The organization's files for automations to send: the "Send a file" flow
 * node and agents with the send_media tool both pick from here. Names and
 * descriptions are what the agent reads to decide which file fits.
 */
export default function MediaLibraryPage() {
  const t = useTranslations("dash.mediaLibrary");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const canManage =
    auth?.user?.orgRole === "ADMIN" || auth?.user?.orgRole === "OWNER";
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setItems(await apiClient<LibraryItem[]>("/media-library", token));
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
    if (!file) return;
    void run(async () => {
      const fd = new FormData();
      fd.append("file", file);
      if (name.trim()) fd.append("name", name.trim());
      if (description.trim()) fd.append("description", description.trim());
      const res = await fetch(`${API_URL}/media-library`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        let message = tc("somethingWentWrong");
        try {
          const body = await res.json();
          if (body.message) {
            message = Array.isArray(body.message)
              ? body.message.join(", ")
              : body.message;
          }
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      setFile(null);
      setName("");
      setDescription("");
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    void run(async () => {
      await apiClient(`/media-library/${editingId}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription,
        }),
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

      {canManage && (
        <form onSubmit={add} className="card flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="btn-ghost text-sm"
              disabled={busy}
            >
              {file ? file.name : t("chooseFile")}
            </button>
            {file && (
              <span className="text-xs text-[var(--color-muted)]">
                {formatSize(file.size)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <input
              className="input w-56"
              maxLength={80}
              placeholder={t("namePlaceholder")}
              aria-label={t("namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <textarea
              className="input min-h-16 flex-1"
              maxLength={500}
              placeholder={t("descriptionPlaceholder")}
              aria-label={t("descriptionPlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !file || (items?.length ?? 0) >= MAX_ITEMS}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {busy ? tc("loading") : t("add")}
            </button>
            <span className="text-xs text-[var(--color-muted)]">
              {t("limits")}
            </span>
            {error && (
              <span className="text-xs text-[var(--color-danger)]">
                {error}
              </span>
            )}
          </div>
        </form>
      )}

      {!canManage && error && (
        <p className="text-xs text-[var(--color-danger)]">{error}</p>
      )}

      {items === null ? (
        <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) =>
            editingId === item.id ? (
              <form
                key={item.id}
                onSubmit={saveEdit}
                className="card flex flex-col gap-3"
              >
                <div className="flex flex-wrap gap-3">
                  <input
                    className="input w-56"
                    maxLength={80}
                    placeholder={t("namePlaceholder")}
                    aria-label={t("namePlaceholder")}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                  <textarea
                    className="input min-h-16 flex-1"
                    maxLength={500}
                    placeholder={t("descriptionPlaceholder")}
                    aria-label={t("descriptionPlaceholder")}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
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
                </div>
              </form>
            ) : (
              <div key={item.id} className="card flex items-start gap-4">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] text-2xl"
                  aria-label={t("preview")}
                >
                  {item.mimeType.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    kindIcon(item.mimeType)
                  )}
                </a>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{item.name}</div>
                  <div className="truncate text-xs text-[var(--color-muted)]">
                    {item.fileName} · {formatSize(item.size)}
                  </div>
                  {item.description && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--color-fg)]">
                      {item.description}
                    </p>
                  )}
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => {
                        setEditingId(item.id);
                        setEditName(item.name);
                        setEditDescription(item.description ?? "");
                      }}
                      className="btn-ghost text-xs"
                    >
                      {tc("edit")}
                    </button>
                    <button
                      onClick={() =>
                        void run(() =>
                          apiClient(`/media-library/${item.id}`, token, {
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
                )}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
