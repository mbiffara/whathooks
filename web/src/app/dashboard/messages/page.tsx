"use client";

import { MessageBubble } from "@/components/messages/message-bubble";
import type {
  ChatMessage,
  Conversation,
  MessagesPage,
} from "@/components/messages/types";
import { previewText, relativeTime } from "@/components/messages/utils";
import { apiClient } from "@/lib/client-api";
import type { WaSession } from "@/lib/types";
import { useSession } from "next-auth/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/v1";
const PAGE_LIMIT = 40;

function mergeMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  // Keep the already-rendered object for ids we've seen, so a poll doesn't swap
  // in a freshly-signed media URL (which would reload <img> and flicker). Only
  // genuinely new messages are added. Return the SAME reference when nothing
  // changed so React skips re-rendering / auto-scroll.
  const seen = new Set(existing.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh].sort(
    (a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

export default function MessagesPage() {
  const { data: auth } = useSession();
  const token = auth?.accessToken;

  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [sessionFilter, setSessionFilter] = useState<string>("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedConv = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );
  const selectedSession = useMemo(
    () =>
      selectedConv
        ? sessions.find((s) => s.id === selectedConv.sessionId) ?? null
        : null,
    [sessions, selectedConv],
  );
  const isConnected = selectedSession
    ? selectedSession.status === "CONNECTED"
    : true;

  // Load sessions once
  useEffect(() => {
    if (!token) return;
    apiClient<WaSession[]>("/sessions", token)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [token]);

  // Load + poll conversations
  const loadConversations = useCallback(async () => {
    if (!token) return;
    const qs = sessionFilter ? `?sessionId=${sessionFilter}` : "";
    try {
      const data = await apiClient<Conversation[]>(`/conversations${qs}`, token);
      setConversations(data);
    } catch {
      /* ignore poll errors */
    } finally {
      setConvLoading(false);
    }
  }, [token, sessionFilter]);

  useEffect(() => {
    setConvLoading(true);
    loadConversations();
    const id = setInterval(loadConversations, 5000);
    return () => clearInterval(id);
  }, [loadConversations]);

  // Load thread when selection changes
  useEffect(() => {
    if (!token || !selectedId) {
      setMessages([]);
      setHasMore(false);
      setOlderCursor(null);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    setMessages([]);
    stickToBottom.current = true;
    apiClient<MessagesPage>(
      `/conversations/${selectedId}/messages?limit=${PAGE_LIMIT}`,
      token,
    )
      .then((res) => {
        if (cancelled) return;
        setMessages(res.items);
        setHasMore(res.hasMore);
        setOlderCursor(res.before);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });

    // mark read
    apiClient(`/conversations/${selectedId}/read`, token, { method: "POST" })
      .then(() => loadConversations())
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedId]);

  // Poll latest messages for the open thread
  useEffect(() => {
    if (!token || !selectedId) return;
    const id = setInterval(async () => {
      try {
        const res = await apiClient<MessagesPage>(
          `/conversations/${selectedId}/messages?limit=${PAGE_LIMIT}`,
          token,
        );
        setMessages((prev) => mergeMessages(prev, res.items));
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(id);
  }, [token, selectedId]);

  // Auto-scroll to bottom when sticking
  useEffect(() => {
    if (stickToBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function onThreadScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
  }

  async function loadOlder() {
    if (!token || !selectedId || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const res = await apiClient<MessagesPage>(
        `/conversations/${selectedId}/messages?before=${encodeURIComponent(
          olderCursor,
        )}&limit=${PAGE_LIMIT}`,
        token,
      );
      stickToBottom.current = false;
      setMessages((prev) => mergeMessages(res.items, prev));
      setHasMore(res.hasMore);
      setOlderCursor(res.before);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch {
      /* ignore */
    } finally {
      setLoadingOlder(false);
    }
  }

  async function refetchThread() {
    if (!token || !selectedId) return;
    try {
      const res = await apiClient<MessagesPage>(
        `/conversations/${selectedId}/messages?limit=${PAGE_LIMIT}`,
        token,
      );
      stickToBottom.current = true;
      setMessages((prev) => mergeMessages(prev, res.items));
    } catch {
      /* ignore */
    }
  }

  async function handleSend() {
    if (!token || !selectedId || sending || !isConnected) return;
    const trimmed = text.trim();
    if (!trimmed && !file) return;
    setSending(true);
    setSendError(null);
    try {
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        if (trimmed) fd.append("text", trimmed);
        const res = await fetch(
          `${API_URL}/conversations/${selectedId}/messages`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          },
        );
        if (!res.ok) throw new Error(`Send failed (${res.status})`);
      } else {
        await apiClient(`/conversations/${selectedId}/messages`, token, {
          method: "POST",
          body: JSON.stringify({ text: trimmed }),
        });
      }
      setText("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refetchThread();
      loadConversations();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-[calc(100vh-5rem)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Left pane */}
      <div className="flex w-[320px] shrink-0 flex-col border-r border-[var(--color-border)]">
        <div className="border-b border-[var(--color-border)] p-3">
          <h1 className="mb-2 text-lg font-semibold">Messages</h1>
          <select
            className="input"
            value={sessionFilter}
            onChange={(e) => setSessionFilter(e.target.value)}
          >
            <option value="">All sessions</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto">
          {convLoading ? (
            <div className="p-4 text-sm text-[var(--color-muted)]">
              Loading conversations…
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-sm text-[var(--color-muted)]">
              No conversations yet.
            </div>
          ) : (
            conversations.map((c) => {
              const display = c.name || `+${c.contact}`;
              const preview = previewText(c.lastMessageText, c.lastMessageType);
              const selected = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`flex w-full items-center gap-3 border-b border-[var(--color-border)] px-3 py-3 text-left transition-colors ${
                    selected
                      ? "bg-[var(--color-surface-2)]"
                      : "hover:bg-[var(--color-surface-2)]"
                  }`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-sm font-semibold uppercase text-[var(--color-brand)]">
                    {(c.name || c.contact || "?").charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-[var(--color-fg)]">
                        {display}
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--color-muted)]">
                        {relativeTime(c.lastMessageAt)}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-[var(--color-muted)]">
                        {preview || " "}
                      </span>
                      {c.unreadCount > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)] px-1.5 text-[10px] font-semibold text-black">
                          {c.unreadCount}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right pane */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selectedConv ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-muted)]">
            Select a conversation
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--color-fg)]">
                  {selectedConv.name || `+${selectedConv.contact}`}
                </div>
                <div className="text-xs text-[var(--color-muted)]">
                  {selectedSession
                    ? `${selectedSession.label} · ${selectedSession.status.toLowerCase()}`
                    : " "}
                </div>
              </div>
            </div>

            <div
              ref={scrollRef}
              onScroll={onThreadScroll}
              className="flex flex-1 flex-col gap-2 overflow-y-auto bg-[var(--color-bg)] p-4"
            >
              {hasMore && (
                <div className="flex justify-center">
                  <button
                    onClick={loadOlder}
                    disabled={loadingOlder}
                    className="btn-ghost rounded-lg px-3 py-1 text-xs disabled:opacity-50"
                  >
                    {loadingOlder ? "Loading…" : "Load older"}
                  </button>
                </div>
              )}
              {threadLoading ? (
                <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-muted)]">
                  Loading messages…
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-muted)]">
                  No messages yet.
                </div>
              ) : (
                messages.map((m) => <MessageBubble key={m.id} message={m} />)
              )}
            </div>

            {/* Composer */}
            <div className="border-t border-[var(--color-border)] p-3">
              {!isConnected && (
                <div className="mb-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-muted)]">
                  This number is disconnected — messages can&apos;t be sent.
                </div>
              )}
              {sendError && (
                <div className="mb-2 text-xs text-red-400">{sendError}</div>
              )}
              {file && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs">
                  <span className="truncate text-[var(--color-fg)]">
                    📎 {file.name}
                  </span>
                  <button
                    onClick={() => {
                      setFile(null);
                      if (fileInputRef.current)
                        fileInputRef.current.value = "";
                    }}
                    className="ml-auto text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                    aria-label="Remove file"
                  >
                    ✕
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!isConnected || sending}
                  className="btn-ghost rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                  aria-label="Attach file"
                >
                  📎
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <textarea
                  className="input flex-1 resize-none"
                  rows={1}
                  placeholder={
                    isConnected ? "Type a message…" : "Number disconnected"
                  }
                  value={text}
                  disabled={!isConnected}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onComposerKeyDown}
                />
                <button
                  onClick={handleSend}
                  disabled={
                    !isConnected ||
                    sending ||
                    (!text.trim() && !file)
                  }
                  className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
