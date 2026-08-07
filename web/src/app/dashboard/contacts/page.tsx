"use client";

import { Glyph } from "@/components/glyphs";
import { apiClient } from "@/lib/client-api";
import type { WaSession } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

interface Contact {
  id: string;
  name: string | null;
  phoneNumber: string | null;
  lid: string | null;
  notes: string | null;
  company: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  /** Sessions (org numbers) this person has written to. */
  sessions: { id: string; label: string }[];
  updatedAt: string;
}

type ContactForm = {
  name: string;
  phoneNumber: string;
  lid: string;
  company: string;
  email: string;
  website: string;
  instagram: string;
  notes: string;
};

const EMPTY: ContactForm = {
  name: "",
  phoneNumber: "",
  lid: "",
  company: "",
  email: "",
  website: "",
  instagram: "",
  notes: "",
};

function toForm(c: Contact): ContactForm {
  return {
    name: c.name ?? "",
    phoneNumber: c.phoneNumber ?? "",
    lid: c.lid ?? "",
    company: c.company ?? "",
    email: c.email ?? "",
    website: c.website ?? "",
    instagram: c.instagram ?? "",
    notes: c.notes ?? "",
  };
}

/** Org contact book — filled by the "Save contact" flow node or by hand. */
export default function ContactsPage() {
  const t = useTranslations("dash.contacts");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [sessionFilter, setSessionFilter] = useState("");
  const [form, setForm] = useState<ContactForm>(EMPTY);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  // The session list only labels the filter — failing to load it must not
  // take the page down.
  useEffect(() => {
    if (!token) return;
    apiClient<WaSession[]>("/sessions", token)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      if (debounced.trim()) params.set("q", debounced.trim());
      if (sessionFilter) params.set("sessionId", sessionFilter);
      const qs = params.toString();
      setContacts(
        await apiClient<Contact[]>(`/contacts${qs ? `?${qs}` : ""}`, token),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    }
  }, [token, debounced, sessionFilter, tc]);

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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      if (editingId) {
        await apiClient(`/contacts/${editingId}`, token, {
          method: "PATCH",
          body: JSON.stringify(form),
        });
      } else {
        await apiClient("/contacts", token, {
          method: "POST",
          body: JSON.stringify(form),
        });
      }
      setForm(EMPTY);
      setFormOpen(false);
      setEditingId(null);
    });
  }

  const field = (key: keyof ContactForm, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-[var(--color-muted)]">{t("subtitle")}</p>
      </div>

      {formOpen && (
        <form onSubmit={submit} className="card flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input
              className="input"
              maxLength={120}
              placeholder={t("name")}
              aria-label={t("name")}
              value={form.name}
              onChange={(e) => field("name", e.target.value)}
            />
            <input
              className="input"
              maxLength={20}
              placeholder={t("phone")}
              aria-label={t("phone")}
              value={form.phoneNumber}
              onChange={(e) =>
                field("phoneNumber", e.target.value.replace(/\D/g, ""))
              }
            />
            <input
              className="input"
              maxLength={20}
              placeholder={t("lid")}
              aria-label={t("lid")}
              value={form.lid}
              onChange={(e) => field("lid", e.target.value.replace(/\D/g, ""))}
            />
            <input
              className="input"
              maxLength={120}
              placeholder={t("company")}
              aria-label={t("company")}
              value={form.company}
              onChange={(e) => field("company", e.target.value)}
            />
            <input
              className="input"
              type="email"
              maxLength={254}
              placeholder={t("email")}
              aria-label={t("email")}
              value={form.email}
              onChange={(e) => field("email", e.target.value)}
            />
            <input
              className="input"
              maxLength={254}
              placeholder={t("website")}
              aria-label={t("website")}
              value={form.website}
              onChange={(e) => field("website", e.target.value)}
            />
            <input
              className="input"
              maxLength={64}
              placeholder={t("instagram")}
              aria-label={t("instagram")}
              value={form.instagram}
              onChange={(e) => field("instagram", e.target.value)}
            />
          </div>
          <textarea
            className="input min-h-16"
            maxLength={4096}
            placeholder={t("notes")}
            aria-label={t("notes")}
            value={form.notes}
            onChange={(e) => field("notes", e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || (!form.phoneNumber.trim() && !form.lid.trim())}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {editingId ? tc("save") : t("add")}
            </button>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
              className="btn-ghost text-sm"
            >
              {tc("cancel")}
            </button>
            {!form.phoneNumber.trim() && !form.lid.trim() && (
              <span className="text-xs text-[var(--color-muted)]">
                {t("needIdentifier")}
              </span>
            )}
            {error && (
              <span className="text-xs text-[var(--color-danger)]">
                {error}
              </span>
            )}
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input w-72"
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input w-52"
          value={sessionFilter}
          onChange={(e) => setSessionFilter(e.target.value)}
          aria-label={t("filterSession")}
        >
          <option value="">{t("allSessions")}</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            setEditingId(null);
            setForm(EMPTY);
            setFormOpen((v) => !v);
          }}
          className="btn-primary ml-auto inline-flex items-center gap-1.5 text-sm"
        >
          <Glyph name="userPlus" size={16} />
          {t("add")}
        </button>
      </div>

      {contacts === null ? (
        <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
      ) : contacts.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">{t("empty")}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase text-[var(--color-muted)]">
                <th className="px-4 py-3 font-medium">{t("colName")}</th>
                <th className="px-4 py-3 font-medium">{t("colPhone")}</th>
                <th className="px-4 py-3 font-medium">{t("colCompany")}</th>
                <th className="px-4 py-3 font-medium">{t("colDetails")}</th>
                <th className="px-4 py-3 font-medium">{t("colSessions")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.name || t("unnamed")}</div>
                    {c.notes && (
                      <div
                        className="mt-0.5 max-w-xs truncate text-xs text-[var(--color-muted)]"
                        title={c.notes}
                      >
                        {c.notes}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">
                    {c.phoneNumber ? (
                      `+${c.phoneNumber}`
                    ) : c.lid ? (
                      <span className="text-[var(--color-muted)]">
                        LID {c.lid}
                      </span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="px-4 py-3">{c.company ?? ""}</td>
                  <td className="px-4 py-3 text-xs text-[var(--color-muted)]">
                    {c.email && <div className="truncate">{c.email}</div>}
                    {c.website && <div className="truncate">{c.website}</div>}
                    {c.instagram && <div>@{c.instagram.replace(/^@/, "")}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(c.sessions ?? []).map((s) => (
                        <span
                          key={s.id}
                          className="badge bg-[var(--color-brand)]/10 text-[10px] text-[var(--color-brand)]"
                          title={t("sessionChip")}
                        >
                          {s.label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => {
                          setEditingId(c.id);
                          setForm(toForm(c));
                          setFormOpen(true);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        aria-label={tc("edit")}
                        title={tc("edit")}
                        className="rounded-lg p-1.5 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                      >
                        <Glyph name="pencil" size={16} />
                      </button>
                      <button
                        onClick={() =>
                          void run(() =>
                            apiClient(`/contacts/${c.id}`, token, {
                              method: "DELETE",
                            }),
                          )
                        }
                        disabled={busy}
                        aria-label={tc("delete")}
                        title={tc("delete")}
                        className="rounded-lg p-1.5 text-[var(--color-muted)] hover:text-[var(--color-danger)] disabled:opacity-50"
                      >
                        <Glyph name="trash" size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
