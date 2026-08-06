"use client";

import { apiClient } from "@/lib/client-api";
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
  const [form, setForm] = useState<ContactForm>(EMPTY);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const params = debounced.trim()
        ? `?q=${encodeURIComponent(debounced.trim())}`
        : "";
      setContacts(await apiClient<Contact[]>(`/contacts${params}`, token));
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    }
  }, [token, debounced, tc]);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-[var(--color-muted)]">{t("subtitle")}</p>
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setForm(EMPTY);
            setFormOpen((v) => !v);
          }}
          className="btn-primary text-sm"
        >
          {t("add")}
        </button>
      </div>

      {formOpen && (
        <form onSubmit={submit} className="card flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input
              className="input"
              maxLength={120}
              placeholder={t("name")}
              value={form.name}
              onChange={(e) => field("name", e.target.value)}
            />
            <input
              className="input"
              maxLength={20}
              placeholder={t("phone")}
              value={form.phoneNumber}
              onChange={(e) =>
                field("phoneNumber", e.target.value.replace(/\D/g, ""))
              }
            />
            <input
              className="input"
              maxLength={20}
              placeholder={t("lid")}
              value={form.lid}
              onChange={(e) => field("lid", e.target.value.replace(/\D/g, ""))}
            />
            <input
              className="input"
              maxLength={120}
              placeholder={t("company")}
              value={form.company}
              onChange={(e) => field("company", e.target.value)}
            />
            <input
              className="input"
              type="email"
              maxLength={254}
              placeholder={t("email")}
              value={form.email}
              onChange={(e) => field("email", e.target.value)}
            />
            <input
              className="input"
              maxLength={254}
              placeholder={t("website")}
              value={form.website}
              onChange={(e) => field("website", e.target.value)}
            />
            <input
              className="input"
              maxLength={64}
              placeholder={t("instagram")}
              value={form.instagram}
              onChange={(e) => field("instagram", e.target.value)}
            />
          </div>
          <textarea
            className="input min-h-16"
            maxLength={4096}
            placeholder={t("notes")}
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

      <input
        className="input w-72"
        placeholder={t("searchPlaceholder")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {contacts === null ? (
        <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
      ) : contacts.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {contacts.map((c) => (
            <div key={c.id} className="card flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">
                    {c.name || t("unnamed")}
                  </span>
                  {c.phoneNumber && (
                    <span className="text-xs text-[var(--color-muted)]">
                      +{c.phoneNumber}
                    </span>
                  )}
                  {!c.phoneNumber && c.lid && (
                    <span className="text-xs text-[var(--color-muted)]">
                      LID {c.lid}
                    </span>
                  )}
                  {c.company && (
                    <span className="badge bg-[var(--color-chip)] text-[var(--color-muted)]">
                      {c.company}
                    </span>
                  )}
                  {(c.sessions ?? []).map((s) => (
                    <span
                      key={s.id}
                      className="badge bg-[var(--color-brand)]/10 text-[var(--color-brand)] text-[10px]"
                      title={t("sessionChip")}
                    >
                      {s.label}
                    </span>
                  ))}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-[var(--color-muted)]">
                  {c.email && <span>{c.email}</span>}
                  {c.website && <span>{c.website}</span>}
                  {c.instagram && <span>@{c.instagram.replace(/^@/, "")}</span>}
                </div>
                {c.notes && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-[var(--color-fg)]">
                    {c.notes}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => {
                    setEditingId(c.id);
                    setForm(toForm(c));
                    setFormOpen(true);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="btn-ghost text-xs"
                >
                  {tc("edit")}
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
                  className="btn-danger text-xs"
                >
                  {tc("delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
