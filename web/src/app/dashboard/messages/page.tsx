"use client";

import { MessageBubble } from "@/components/messages/message-bubble";
import type {
  ChatMessage,
  Conversation,
  ConversationTag,
  MessagesPage,
  QuickReply,
} from "@/components/messages/types";
import { previewText, relativeTime } from "@/components/messages/utils";
import { UpgradeModal } from "@/components/upgrade-modal";
import { ApiError, apiClient, isSubscriptionRequired } from "@/lib/client-api";
import type { TeamMember, WaSession } from "@/lib/types";
import { useTranslations } from "next-intl";
import { Glyph } from "@/components/glyphs";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
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
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

function MessagesInbox() {
  const t = useTranslations("dash.messages");
  const searchParams = useSearchParams();
  const tc = useTranslations("common");
  const tStatus = useTranslations("dash.status");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const isPlatformAdmin = auth?.user?.role === "ADMIN";

  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [sessionFilter, setSessionFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "RESOLVED" | "ALL">(
    "OPEN",
  );
  const [assignedFilter, setAssignedFilter] = useState<
    "all" | "me" | "unassigned"
  >("all");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [updatingConv, setUpdatingConv] = useState(false);
  const [tags, setTags] = useState<ConversationTag[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const [noteMode, setNoteMode] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrFilter, setQrFilter] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("c"),
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [togglingAgent, setTogglingAgent] = useState(false);

  // "New conversation" dialog.
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [newConvSession, setNewConvSession] = useState("");
  const [newConvNumber, setNewConvNumber] = useState("");
  const [newConvBusy, setNewConvBusy] = useState(false);
  const [newConvError, setNewConvError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedConv = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );
  const qrFiltered = useMemo(() => {
    const needle = qrFilter.trim().toLowerCase();
    if (!needle) return quickReplies;
    return quickReplies.filter((q) =>
      `${q.title ?? ""} ${q.text}`.toLowerCase().includes(needle),
    );
  }, [quickReplies, qrFilter]);
  const selectedSession = useMemo(
    () =>
      selectedConv
        ? (sessions.find((s) => s.id === selectedConv.sessionId) ?? null)
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

  // Team members for the assignee picker (best-effort).
  useEffect(() => {
    if (!token) return;
    apiClient<TeamMember[]>("/organizations/members", token)
      .then(setMembers)
      .catch(() => setMembers([]));
    apiClient<ConversationTag[]>("/tags", token)
      .then(setTags)
      .catch(() => setTags([]));
    apiClient<QuickReply[]>("/quick-replies", token)
      .then(setQuickReplies)
      .catch(() => setQuickReplies([]));
  }, [token]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  // Load + poll conversations
  const loadConversations = useCallback(async () => {
    if (!token) return;
    const params = new URLSearchParams();
    if (sessionFilter) params.set("sessionId", sessionFilter);
    if (debouncedSearch) params.set("q", debouncedSearch);
    params.set("status", statusFilter);
    if (assignedFilter !== "all") params.set("assigned", assignedFilter);
    if (tagFilter) params.set("tag", tagFilter);
    try {
      const data = await apiClient<Conversation[]>(
        `/conversations?${params.toString()}`,
        token,
      );
      setConversations(data);
    } catch {
      /* ignore poll errors */
    } finally {
      setConvLoading(false);
    }
  }, [
    token,
    sessionFilter,
    debouncedSearch,
    statusFilter,
    assignedFilter,
    tagFilter,
  ]);

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
        if (!res.ok) {
          let message = t("sendFailedStatus", { status: res.status });
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
          throw new ApiError(message, res.status);
        }
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
      if (isSubscriptionRequired(e)) {
        setShowUpgrade(true);
      } else {
        setSendError(e instanceof Error ? e.message : t("failedToSend"));
      }
    } finally {
      setSending(false);
    }
  }

  async function updateConversation(patch: {
    assignedToUserId?: string | null;
    status?: "OPEN" | "RESOLVED";
    tagIds?: string[];
  }) {
    if (!token || !selectedConv || updatingConv) return;
    setUpdatingConv(true);
    try {
      const updated = await apiClient<Conversation>(
        `/conversations/${selectedConv.id}`,
        token,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      );
    } catch {
      /* surface via next poll */
    } finally {
      setUpdatingConv(false);
    }
  }

  async function toggleTag(tagId: string) {
    if (!selectedConv) return;
    const current = selectedConv.tags.map((t) => t.id);
    const next = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    await updateConversation({ tagIds: next });
  }

  async function createTag() {
    const name = newTagName.trim();
    if (!token || !name) return;
    setTagError(null);
    try {
      const created = await apiClient<ConversationTag>("/tags", token, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setTags((prev) =>
        prev.some((t) => t.id === created.id)
          ? prev
          : [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setNewTagName("");
      await toggleTag(created.id);
      setTagPickerOpen(false);
    } catch (e) {
      setTagError(e instanceof Error ? e.message : tc("somethingWentWrong"));
    }
  }

  async function sendNote() {
    if (!token || !selectedId || sending) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    setSendError(null);
    try {
      await apiClient(`/conversations/${selectedId}/notes`, token, {
        method: "POST",
        body: JSON.stringify({ text: trimmed }),
      });
      setText("");
      await refetchThread();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : t("failedToSend"));
    } finally {
      setSending(false);
    }
  }

  async function toggleAgentPause() {
    if (!token || !selectedConv || togglingAgent) return;
    const next = !selectedConv.agentPaused;
    setTogglingAgent(true);
    // Optimistically flip the flag so the header updates immediately.
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedConv.id ? { ...c, agentPaused: next } : c,
      ),
    );
    try {
      await apiClient(`/conversations/${selectedConv.id}/agent/pause`, token, {
        method: "POST",
        body: JSON.stringify({ paused: next }),
      });
    } catch {
      // Revert on failure.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedConv.id ? { ...c, agentPaused: !next } : c,
        ),
      );
    } finally {
      setTogglingAgent(false);
      loadConversations();
    }
  }

  // Save a sent message's text as an org-shared quick reply (the API
  // dedupes on identical text, so re-saving is a no-op).
  async function saveQuickReply(text: string) {
    if (!token || !text.trim()) return;
    try {
      const saved = await apiClient<QuickReply>("/quick-replies", token, {
        method: "POST",
        body: JSON.stringify({ text: text.trim() }),
      });
      setQuickReplies((prev) => [
        saved,
        ...prev.filter((q) => q.id !== saved.id),
      ]);
    } catch {
      /* cap reached or transient failure — nothing to roll back */
    }
  }

  // Platform-admin testing tool: the API also clears flow/mirror state so
  // the next inbound message starts the automation from scratch.
  async function deleteConversation() {
    if (!token || !selectedConv || updatingConv) return;
    if (!confirm(t("confirmDelete"))) return;
    setUpdatingConv(true);
    try {
      await apiClient(`/conversations/${selectedConv.id}`, token, {
        method: "DELETE",
      });
      setConversations((prev) => prev.filter((c) => c.id !== selectedConv.id));
      setSelectedId(null);
    } finally {
      setUpdatingConv(false);
    }
  }

  function openNewConversation() {
    const connected = sessions.filter((s) => s.status === "CONNECTED");
    setNewConvSession(
      sessionFilter && connected.some((s) => s.id === sessionFilter)
        ? sessionFilter
        : (connected[0]?.id ?? ""),
    );
    setNewConvNumber("");
    setNewConvError(null);
    setNewConvOpen(true);
  }

  async function startConversation(e: React.FormEvent) {
    e.preventDefault();
    if (!token || newConvBusy) return;
    setNewConvBusy(true);
    setNewConvError(null);
    try {
      const conv = await apiClient<Conversation>("/conversations", token, {
        method: "POST",
        body: JSON.stringify({
          sessionId: newConvSession,
          to: newConvNumber.trim(),
        }),
      });
      setNewConvOpen(false);
      setConversations((prev) =>
        prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev],
      );
      setSelectedId(conv.id);
      loadConversations();
    } catch (e) {
      setNewConvError(
        e instanceof Error ? e.message : tc("somethingWentWrong"),
      );
    } finally {
      setNewConvBusy(false);
    }
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (noteMode) void sendNote();
      else handleSend();
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {newConvOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setNewConvOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-conv-title"
        >
          <form
            className="card w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
            onSubmit={startConversation}
          >
            <h2 id="new-conv-title" className="text-lg font-semibold">
              {t("newConversation")}
            </h2>
            {sessions.some((s) => s.status === "CONNECTED") ? (
              <>
                <div className="mt-4">
                  <label className="label">{t("newConvSession")}</label>
                  <select
                    className="input"
                    value={newConvSession}
                    onChange={(e) => setNewConvSession(e.target.value)}
                  >
                    {sessions
                      .filter((s) => s.status === "CONNECTED")
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                          {s.phoneNumber ? ` — ${s.phoneNumber}` : ""}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="mt-3">
                  <label className="label">{t("newConvNumber")}</label>
                  <input
                    className="input"
                    placeholder="5491155551234"
                    inputMode="tel"
                    autoFocus
                    value={newConvNumber}
                    onChange={(e) => setNewConvNumber(e.target.value)}
                    required
                  />
                  <p className="mt-1 text-xs text-[var(--color-muted)]">
                    {t("newConvNumberHint")}
                  </p>
                </div>
                <p className="mt-3 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning)]">
                  ⚠ {t("newConvColdWarning")}
                </p>
                {newConvError && (
                  <p className="mt-3 text-sm text-[var(--color-danger)]">
                    {newConvError}
                  </p>
                )}
                <div className="mt-5 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setNewConvOpen(false)}
                    className="btn-ghost"
                  >
                    {tc("cancel")}
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={newConvBusy || !newConvSession}
                  >
                    {newConvBusy ? tc("loading") : t("newConvStart")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-[var(--color-muted)]">
                  {t("newConvNoSessions")}
                </p>
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setNewConvOpen(false)}
                    className="btn-ghost"
                  >
                    {tc("close")}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
      {/* Left pane — on phones it swaps with the thread (master-detail) */}
      <div
        className={`${
          selectedId ? "hidden md:flex" : "flex"
        } w-full shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] md:w-[320px] lg:w-[360px]`}
      >
        <div className="border-b border-[var(--color-border)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <h1 className="text-lg font-semibold">{t("title")}</h1>
            <button
              onClick={openNewConversation}
              className="btn-ghost px-2 py-1 text-xs"
              title={t("newConversation")}
            >
              + {t("newConversation")}
            </button>
          </div>
          <select
            className="input"
            value={sessionFilter}
            onChange={(e) => setSessionFilter(e.target.value)}
          >
            <option value="">{t("allSessions")}</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            className="input mt-2"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <select
              className="input h-8 flex-1 px-2 py-0 text-xs"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as typeof statusFilter)
              }
            >
              <option value="OPEN">{t("filterOpen")}</option>
              <option value="RESOLVED">{t("filterResolved")}</option>
              <option value="ALL">{t("filterAllStatus")}</option>
            </select>
            <select
              className="input h-8 flex-1 px-2 py-0 text-xs"
              value={assignedFilter}
              onChange={(e) =>
                setAssignedFilter(e.target.value as typeof assignedFilter)
              }
            >
              <option value="all">{t("filterAllAssigned")}</option>
              <option value="me">{t("filterMine")}</option>
              <option value="unassigned">{t("filterUnassigned")}</option>
            </select>
          </div>
          {tags.length > 0 && (
            <select
              className="input mt-2 h-8 w-full px-2 py-0 text-xs"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
            >
              <option value="">{t("filterAllTags")}</option>
              {tags.map((tg) => (
                <option key={tg.id} value={tg.id}>
                  {tg.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {convLoading ? (
            <div className="p-4 text-sm text-[var(--color-muted)]">
              {t("loadingConversations")}
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-sm text-[var(--color-muted)]">
              {t("noConversations")}
            </div>
          ) : (
            conversations.map((c) => {
              const display = c.name || `+${c.contact}`;
              const preview = previewText(
                c.lastMessageText,
                c.lastMessageType,
                t.raw("preview") as Record<string, string>,
              );
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
                  {c.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.avatarUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-sm font-semibold uppercase text-[var(--color-brand)]">
                      {(c.name || c.contact || "?").charAt(0)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-[var(--color-fg)]">
                        {display}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--color-muted)]">
                        {c.status === "RESOLVED" && (
                          <span title={t("resolved")}>✓</span>
                        )}
                        {c.assignedTo && (
                          <span
                            title={c.assignedTo.name}
                            className="grid h-4 w-4 place-items-center rounded-full bg-[var(--color-brand)]/20 text-[8px] font-bold uppercase text-[var(--color-brand)]"
                          >
                            {c.assignedTo.name.charAt(0)}
                          </span>
                        )}
                        {relativeTime(c.lastMessageAt, t("now"))}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-[var(--color-muted)]">
                        {preview || " "}
                      </span>
                      {c.unreadCount > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)] px-1.5 text-[10px] font-semibold text-[var(--color-on-brand)]">
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
      <div
        className={`${
          selectedId ? "flex" : "hidden md:flex"
        } min-w-0 flex-1 flex-col`}
      >
        {!selectedConv ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-muted)]">
            {t("selectConversation")}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
              <button
                onClick={() => setSelectedId(null)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] md:hidden"
                aria-label={t("title")}
              >
                <Glyph name="chevronLeft" size={18} />
              </button>
              <div className="flex min-w-0 items-center gap-2.5">
                {selectedConv.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedConv.avatarUrl}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-sm font-semibold uppercase text-[var(--color-brand)]">
                    {(selectedConv.name || selectedConv.contact || "?").charAt(
                      0,
                    )}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="truncate font-medium text-[var(--color-fg)]">
                    {selectedConv.name || `+${selectedConv.contact}`}
                  </div>
                  <div className="truncate text-xs text-[var(--color-muted)]">
                    {[
                      !selectedConv.isGroup && selectedConv.name
                        ? `+${selectedConv.contact}`
                        : null,
                      selectedSession
                        ? `${selectedSession.label} · ${tStatus(selectedSession.status).toLowerCase()}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || " "}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <select
                  className="input h-8 w-36 px-2 py-0 text-xs"
                  value={selectedConv.assignedTo?.id ?? ""}
                  disabled={updatingConv}
                  onChange={(e) =>
                    updateConversation({
                      assignedToUserId: e.target.value || null,
                    })
                  }
                  aria-label={t("assignee")}
                >
                  <option value="">{t("noAssignee")}</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name ?? m.email}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() =>
                    updateConversation({
                      status:
                        selectedConv.status === "RESOLVED"
                          ? "OPEN"
                          : "RESOLVED",
                    })
                  }
                  disabled={updatingConv}
                  className="btn-ghost rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {selectedConv.status === "RESOLVED"
                    ? t("reopen")
                    : t("resolve")}
                </button>
                {isPlatformAdmin && (
                  <button
                    onClick={deleteConversation}
                    disabled={updatingConv}
                    className="btn-danger text-xs disabled:opacity-50"
                  >
                    {t("deleteConversation")}
                  </button>
                )}
              </div>

              {selectedConv.agent && (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {!selectedConv.agent.enabled ? (
                    <span className="badge bg-[var(--color-chip)] text-[var(--color-muted)]">
                      {t("agentDisabled", { name: selectedConv.agent.name })}
                    </span>
                  ) : selectedConv.agentPaused ? (
                    <>
                      <span
                        className="badge max-w-[22rem] truncate bg-[var(--color-warning-bg)] text-[var(--color-warning)]"
                        title={selectedConv.agentPausedReason ?? undefined}
                      >
                        {selectedConv.agentPausedReason
                          ? t("agentHandedOff", {
                              reason: selectedConv.agentPausedReason,
                            })
                          : t("agentPausedManual")}
                      </span>
                      <button
                        onClick={toggleAgentPause}
                        disabled={togglingAgent}
                        className="btn-ghost rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                      >
                        {t("resumeAgent", { name: selectedConv.agent.name })}
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="badge bg-[var(--color-brand)]/15 text-[var(--color-brand)]">
                        {selectedConv.isGroup
                          ? t("agentGroupReplies", {
                              name: selectedConv.agent.name,
                            })
                          : t("agentResponding", {
                              name: selectedConv.agent.name,
                            })}
                      </span>
                      <button
                        onClick={toggleAgentPause}
                        disabled={togglingAgent}
                        className="btn-ghost rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                      >
                        {t("pauseAgent")}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--color-border)] px-4 py-2">
              {selectedConv.tags.map((tg) => (
                <button
                  key={tg.id}
                  onClick={() => toggleTag(tg.id)}
                  title={tg.name}
                  className="rounded-full border px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    color: tg.color,
                    borderColor: `${tg.color}55`,
                    backgroundColor: `${tg.color}1a`,
                  }}
                >
                  {tg.name} ×
                </button>
              ))}
              <div className="relative">
                <button
                  onClick={() => setTagPickerOpen((v) => !v)}
                  className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                >
                  {t("addTag")}
                </button>
                {tagPickerOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-20"
                      onClick={() => setTagPickerOpen(false)}
                    />
                    <div className="absolute left-0 top-6 z-30 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg">
                      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                        {tags.map((tg) => {
                          const active = selectedConv.tags.some(
                            (x) => x.id === tg.id,
                          );
                          return (
                            <button
                              key={tg.id}
                              onClick={async () => {
                                await toggleTag(tg.id);
                                setTagPickerOpen(false);
                              }}
                              className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-[var(--color-surface-2)] ${
                                active ? "font-semibold" : ""
                              }`}
                            >
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: tg.color }}
                              />
                              <span className="flex-1 truncate">{tg.name}</span>
                              {active && <span>✓</span>}
                            </button>
                          );
                        })}
                      </div>
                      {tagError && (
                        <p className="mt-1 px-1 text-[10px] text-[var(--color-danger)]">
                          {tagError}
                        </p>
                      )}
                      <div className="mt-2 flex gap-1 border-t border-[var(--color-border)] pt-2">
                        <input
                          className="input h-7 flex-1 px-2 py-0 text-xs"
                          placeholder={t("newTagPlaceholder")}
                          value={newTagName}
                          onChange={(e) => setNewTagName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void createTag();
                            }
                          }}
                        />
                        <button
                          onClick={() => void createTag()}
                          disabled={!newTagName.trim()}
                          className="btn-primary h-7 px-2 py-0 text-xs"
                        >
                          {t("createTag")}
                        </button>
                      </div>
                    </div>
                  </>
                )}
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
                    {loadingOlder ? t("loadingMessages") : t("loadOlder")}
                  </button>
                </div>
              )}
              {threadLoading ? (
                <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-muted)]">
                  {t("loadingMessages")}
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-muted)]">
                  {t("noMessages")}
                </div>
              ) : (
                messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    onSaveQuickReply={saveQuickReply}
                  />
                ))
              )}
            </div>

            {/* Composer */}
            <div className="border-t border-[var(--color-border)] p-3">
              {!isConnected && (
                <div className="mb-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-muted)]">
                  {t("disconnectedNote")}
                </div>
              )}
              {sendError && (
                <div className="mb-2 text-xs text-[var(--color-danger)]">
                  {sendError}
                </div>
              )}
              <UpgradeModal
                open={showUpgrade}
                onClose={() => setShowUpgrade(false)}
                action={t("sendingAction")}
              />
              {file && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs">
                  <span className="truncate text-[var(--color-fg)]">
                    📎 {file.name}
                  </span>
                  <button
                    onClick={() => {
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="ml-auto text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                    aria-label={t("removeFile")}
                  >
                    ✕
                  </button>
                </div>
              )}
              <div className="mb-2 flex gap-1">
                <button
                  onClick={() => setNoteMode(false)}
                  className={`rounded-md px-2 py-1 text-xs ${
                    !noteMode
                      ? "bg-[var(--color-surface-2)] font-medium"
                      : "text-[var(--color-muted)]"
                  }`}
                >
                  {t("modeReply")}
                </button>
                <button
                  onClick={() => setNoteMode(true)}
                  className={`rounded-md px-2 py-1 text-xs ${
                    noteMode
                      ? "bg-[var(--color-warning-bg)] font-medium text-[var(--color-warning)]"
                      : "text-[var(--color-muted)]"
                  }`}
                >
                  🗒 {t("modeNote")}
                </button>
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={noteMode || !isConnected || sending}
                  className="btn-ghost rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                  aria-label={t("attachFile")}
                >
                  📎
                </button>
                <span className="relative">
                  <button
                    onClick={() => {
                      setQrOpen((v) => !v);
                      setQrFilter("");
                    }}
                    disabled={noteMode || !isConnected || sending}
                    className="btn-ghost rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                    aria-label={t("quickReplies")}
                    title={t("quickReplies")}
                  >
                    ⚡
                  </button>
                  {qrOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setQrOpen(false)}
                      />
                      <div className="absolute bottom-full left-0 z-20 mb-2 w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg">
                        <input
                          autoFocus
                          value={qrFilter}
                          onChange={(e) => setQrFilter(e.target.value)}
                          placeholder={t("searchQuickReplies")}
                          className="input mb-2 w-full text-xs"
                        />
                        <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                          {qrFiltered.length === 0 ? (
                            <p className="px-2 py-3 text-center text-xs text-[var(--color-muted)]">
                              {t("noQuickReplies")}
                            </p>
                          ) : (
                            qrFiltered.map((q) => (
                                <button
                                  key={q.id}
                                  onClick={() => {
                                    setText((prev) =>
                                      prev.trim()
                                        ? `${prev.trimEnd()} ${q.text}`
                                        : q.text,
                                    );
                                    setQrOpen(false);
                                  }}
                                  className="rounded-lg px-2.5 py-2 text-left hover:bg-[var(--color-surface-2)]"
                                >
                                  {q.title && (
                                    <span className="block text-[10px] font-semibold text-[var(--color-brand)]">
                                      {q.title}
                                    </span>
                                  )}
                                  <span className="block truncate text-xs text-[var(--color-fg)]">
                                    {q.text}
                                  </span>
                                </button>
                              ))
                          )}
                        </div>
                        <Link
                          href="/dashboard/quick-replies"
                          className="block border-t border-[var(--color-border)] px-2 pb-0.5 pt-2 text-[11px] text-[var(--color-brand)] hover:underline"
                        >
                          {t("manageQuickReplies")}
                        </Link>
                      </div>
                    </>
                  )}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <textarea
                  className={`input flex-1 resize-none ${
                    noteMode
                      ? "border-[var(--color-warning)]/50 bg-[var(--color-warning-bg)]"
                      : ""
                  }`}
                  rows={1}
                  placeholder={
                    noteMode
                      ? t("notePlaceholder")
                      : isConnected
                        ? t("typeMessage")
                        : t("numberDisconnected")
                  }
                  value={text}
                  disabled={!noteMode && !isConnected}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onComposerKeyDown}
                />
                <button
                  onClick={noteMode ? sendNote : handleSend}
                  disabled={
                    sending ||
                    (noteMode
                      ? !text.trim()
                      : !isConnected || (!text.trim() && !file))
                  }
                  className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
                >
                  {sending ? t("sending") : noteMode ? t("addNote") : t("send")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesInbox />
    </Suspense>
  );
}
