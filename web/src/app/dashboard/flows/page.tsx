"use client";

import { Glyph } from "@/components/glyphs";
import { StatusBadge } from "@/components/status-badge";
import { apiClient } from "@/lib/client-api";
import type { WaSession, WaStatus } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const TEMPLATE_KEYS = [
  "blank",
  "ai-until-handoff",
  "intent-routing",
  "round-robin",
  "faq-keyword",
] as const;

interface FlowRow {
  id: string;
  name: string;
  enabled: boolean;
  nodes: number;
  session: {
    id: string;
    label: string;
    phoneNumber: string | null;
    status: WaStatus;
  } | null;
  updatedAt: string;
}

/** Flows list — platform-admin experiment. */
export default function FlowsPage() {
  const t = useTranslations("dash.flows");
  const tc = useTranslations("common");
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<string>("blank");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setFlows(await apiClient<FlowRow[]>("/flows", token));
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const flow = await apiClient<{ id: string }>("/flows", token, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), template }),
      });
      window.location.href = `/dashboard/flows/${flow.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("failedToCreate"));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">
          {t("title")}{" "}
          <span className="badge bg-[var(--color-warning-bg)] text-[var(--color-warning)] align-middle text-xs">
            {t("experimental")}
          </span>
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {t("subtitle")}
        </p>
      </div>

      <form onSubmit={create} className="card flex flex-wrap items-end gap-3">
        <div className="min-w-52 flex-1">
          <label className="label">{t("nameLabel")}</label>
          <input
            className="input"
            placeholder={t("namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
        </div>
        <div className="w-full">
          <label className="label">{t("startFrom")}</label>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {TEMPLATE_KEYS.map((key) => (
              <button
                type="button"
                key={key}
                onClick={() => setTemplate(key)}
                className={`rounded-xl border p-3 text-left ${
                  template === key
                    ? "border-[var(--color-brand)] bg-[var(--color-brand)]/5"
                    : "border-[var(--color-border)] hover:border-[var(--color-brand)]/40"
                }`}
              >
                <div className="text-sm font-medium">
                  {t(`templates.${key}.title`)}
                </div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  {t(`templates.${key}.desc`)}
                </div>
              </button>
            ))}
          </div>
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          {t("createFlow")}
        </button>
      </form>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
      ) : flows.length === 0 ? (
        <div className="card text-sm text-[var(--color-muted)]">
          {t("noFlows")}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {flows.map((f) => (
            <Link
              key={f.id}
              href={`/dashboard/flows/${f.id}`}
              className="card flex items-center gap-4 hover:border-[var(--color-brand)]/40"
            >
              <div className="min-w-0">
                <div className="font-medium">{f.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  {f.session ? (
                    <>
                      {f.session.label}
                      {f.session.phoneNumber && ` (+${f.session.phoneNumber})`}
                      <StatusBadge status={f.session.status} />
                    </>
                  ) : (
                    <span className="badge bg-[var(--color-chip)] text-[var(--color-muted)]">
                      {t("draft")}
                    </span>
                  )}
                </div>
              </div>
              <span className="ml-auto text-xs text-[var(--color-muted)]">
                {t("nodeCount", { count: f.nodes })}
              </span>
              <span
                className={`badge ${
                  f.enabled
                    ? "bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
                    : "bg-[var(--color-chip)] text-[var(--color-muted)]"
                }`}
              >
                {f.enabled ? tc("enabled") : tc("disabled")}
              </span>
              <Glyph
                name="chevronRight"
                className="text-[var(--color-muted)]"
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
