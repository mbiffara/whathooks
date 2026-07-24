"use client";

import { API_URL, apiClient } from "@/lib/client-api";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

interface KnowledgeDoc {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  charCount: number;
  createdAt: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Knowledge documents for one agent: PDFs / text files whose extracted text
 * is injected into the agent's system prompt (context injection, no RAG).
 */
export function AgentKnowledge({ agentId }: { agentId: string }) {
  const t = useTranslations("dash.agents.knowledge");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setDocs(
        await apiClient<KnowledgeDoc[]>(`/agents/${agentId}/knowledge`, token),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    }
  }, [token, agentId, tc]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(file: File) {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_URL}/agents/${agentId}/knowledge`, {
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
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(docId: string) {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/agents/${agentId}/knowledge/${docId}`, token, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  const totalChars = (docs ?? []).reduce((s, d) => s + d.charCount, 0);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-[var(--color-muted)]">{t("hint")}</p>
      {docs === null ? (
        <p className="text-xs text-[var(--color-muted)]">{tc("loading")}</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-[var(--color-muted)]">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-xs"
            >
              <span className="truncate">📄 {d.fileName}</span>
              <span className="ml-auto shrink-0 text-[var(--color-muted)]">
                {formatSize(d.sizeBytes)}
              </span>
              <button
                onClick={() => remove(d.id)}
                disabled={busy}
                className="shrink-0 text-[var(--color-muted)] hover:text-[var(--color-danger)]"
                aria-label={tc("delete")}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      <div className="flex items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,.markdown,.csv,application/pdf,text/plain,text/markdown,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy || (docs?.length ?? 0) >= 5}
          className="btn-ghost text-xs"
        >
          {busy ? tc("loading") : `+ ${t("upload")}`}
        </button>
        {docs !== null && docs.length > 0 && (
          <span className="text-[10px] text-[var(--color-muted)]">
            {t("usage", {
              docs: docs.length,
              chars: totalChars.toLocaleString(),
            })}
          </span>
        )}
      </div>
    </div>
  );
}
