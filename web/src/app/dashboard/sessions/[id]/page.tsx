"use client";

import { StatusBadge } from "@/components/status-badge";
import { apiClient } from "@/lib/client-api";
import type { WaSessionDetail } from "@/lib/types";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const router = useRouter();

  const [session, setSession] = useState<WaSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [sendResult, setSendResult] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiClient<WaSessionDetail>(`/sessions/${id}`, token);
      setSession(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [id, token]);

  // Poll while not connected so the QR / status stays fresh.
  useEffect(() => {
    if (!token) return;
    let active = true;
    const tick = async () => {
      await load();
      if (!active) return;
      timer.current = setTimeout(tick, 2500);
    };
    tick();
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [token, load]);

  async function act(path: string, method = "POST") {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/sessions/${id}${path}`, token, { method });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!token) return;
    setBusy(true);
    try {
      await apiClient(`/sessions/${id}`, token, { method: "DELETE" });
      router.push("/dashboard/sessions");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
    }
  }

  async function sendTest(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSendResult(null);
    setError(null);
    try {
      await apiClient(`/sessions/${id}/test-message`, token, {
        method: "POST",
        body: JSON.stringify({ to, text }),
      });
      setSendResult("Message sent ✓");
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    }
  }

  if (!session) {
    return <p className="text-sm text-[var(--color-muted)]">Loading…</p>;
  }

  const isQr = session.status === "QR" && session.qrDataUrl;
  const isConnected = session.status === "CONNECTED";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => router.push("/dashboard/sessions")}
            className="mb-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            ← Sessions
          </button>
          <h1 className="text-2xl font-bold">{session.label}</h1>
          <div className="mt-2 flex items-center gap-3">
            <StatusBadge status={session.status} />
            {session.phoneNumber && (
              <span className="text-sm text-[var(--color-muted)]">
                +{session.phoneNumber}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {(session.status === "DISCONNECTED" ||
            session.status === "LOGGED_OUT" ||
            session.status === "PENDING") && (
            <button onClick={() => act("/connect")} className="btn-ghost" disabled={busy}>
              Reconnect
            </button>
          )}
          {isConnected && (
            <button onClick={() => act("/logout")} className="btn-ghost" disabled={busy}>
              Log out
            </button>
          )}
          <button onClick={remove} className="btn-danger" disabled={busy}>
            Delete
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {isQr && (
        <div className="card flex flex-col items-center gap-4 text-center">
          <h2 className="font-semibold">Scan to connect</h2>
          <p className="max-w-sm text-sm text-[var(--color-muted)]">
            Open WhatsApp on your phone → <b>Settings → Linked Devices → Link a
            device</b>, then scan this code.
          </p>
          <div className="rounded-xl bg-white p-3">
            <Image
              src={session.qrDataUrl!}
              alt="WhatsApp QR code"
              width={280}
              height={280}
              unoptimized
            />
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            The code refreshes automatically.
          </p>
        </div>
      )}

      {(session.status === "CONNECTING" || session.status === "PENDING") && !isQr && (
        <div className="card text-center text-sm text-[var(--color-muted)]">
          Establishing connection… a QR code will appear shortly.
        </div>
      )}

      {isConnected && (
        <div className="card">
          <h2 className="mb-1 font-semibold">Send a test message</h2>
          <p className="mb-4 text-sm text-[var(--color-muted)]">
            Phone number with country code, no “+”. e.g. 15551234567
          </p>
          <form onSubmit={sendTest} className="flex flex-col gap-3">
            <input
              className="input"
              placeholder="Recipient number"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
            <textarea
              className="input min-h-20"
              placeholder="Your message"
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
            />
            <div className="flex items-center gap-3">
              <button type="submit" className="btn-primary">
                Send
              </button>
              {sendResult && (
                <span className="text-sm text-[var(--color-brand)]">{sendResult}</span>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
