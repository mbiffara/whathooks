"use client";

import type { MappingRule } from "@/lib/types";
import { useTranslations } from "next-intl";

export const WEBHOOK_EVENTS = [
  "message.received",
  "session.status",
  "session.qr",
  "contact.created",
  "contact.updated",
];

/** Source paths offered in the editor (free text is also allowed). */
const SOURCE_SUGGESTIONS = [
  "data.id",
  "data.from",
  "data.pushName",
  "data.type",
  "data.text",
  "data.media.url",
  "data.media.mimeType",
  "data.media.fileName",
  "data.waMessageId",
  "data.timestamp",
  "data.conversationId",
  "event",
  "sessionId",
  "timestamp",
];

/** Editable row: a MappingRule plus which kind the user picked. */
export interface RuleRow {
  target: string;
  kind: "field" | "fixed";
  source: string;
  value: string;
  dateFormat: string;
}

export const emptyRow = (): RuleRow => ({
  target: "",
  kind: "field",
  source: "",
  value: "",
  dateFormat: "",
});

export function rowsToRules(rows: RuleRow[]): MappingRule[] {
  return rows
    .filter((r) => r.target.trim())
    .map((r) =>
      r.kind === "fixed"
        ? { target: r.target.trim(), value: r.value }
        : {
            target: r.target.trim(),
            source: r.source.trim(),
            ...(r.dateFormat.trim() ? { dateFormat: r.dateFormat.trim() } : {}),
          },
    )
    .filter((r) => ("source" in r ? Boolean(r.source) : true));
}

export function rulesToRows(rules: MappingRule[] | null): RuleRow[] {
  if (!rules?.length) return [];
  return rules.map((r) => ({
    target: r.target,
    kind: r.source !== undefined ? "field" : "fixed",
    source: r.source ?? "",
    value: r.value == null ? "" : String(r.value),
    dateFormat: r.dateFormat ?? "",
  }));
}

export function MappingEditor({
  rows,
  onChange,
}: {
  rows: RuleRow[];
  onChange: (rows: RuleRow[]) => void;
}) {
  const t = useTranslations("dash.webhooks");
  function patch(i: number, changes: Partial<RuleRow>) {
    onChange(rows.map((row, j) => (j === i ? { ...row, ...changes } : row)));
  }

  return (
    <div className="flex flex-col gap-2">
      <datalist id="wh-source-paths">
        {SOURCE_SUGGESTIONS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2"
        >
          <input
            className="input h-9 w-36 flex-none text-xs"
            placeholder="output_field"
            value={row.target}
            onChange={(e) => patch(i, { target: e.target.value })}
          />
          <span className="text-xs text-[var(--color-muted)]">←</span>
          <select
            className="input h-9 w-28 flex-none text-xs"
            value={row.kind}
            onChange={(e) =>
              patch(i, { kind: e.target.value as RuleRow["kind"] })
            }
          >
            <option value="field">{t("kindField")}</option>
            <option value="fixed">{t("kindFixed")}</option>
          </select>
          {row.kind === "field" ? (
            <>
              <input
                className="input h-9 min-w-36 flex-1 text-xs"
                placeholder="data.from"
                list="wh-source-paths"
                value={row.source}
                onChange={(e) => patch(i, { source: e.target.value })}
              />
              <input
                className="input h-9 w-40 flex-none text-xs"
                placeholder={t("dateFormatPlaceholder")}
                title={t("dateFormatTitle")}
                value={row.dateFormat}
                onChange={(e) => patch(i, { dateFormat: e.target.value })}
              />
            </>
          ) : (
            <input
              className="input h-9 min-w-36 flex-1 text-xs"
              placeholder={t("valuePlaceholder")}
              value={row.value}
              onChange={(e) => patch(i, { value: e.target.value })}
            />
          )}
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="btn-ghost h-9 px-2 text-xs"
            aria-label={t("removeField")}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange([...rows, emptyRow()])}
          className="btn-ghost self-start text-xs"
        >
          {t("addField")}
        </button>
        {rows.length > 0 && (
          <p className="text-xs text-[var(--color-muted)]">
            {t.rich("mappingHint", { code: (c) => <code>{c}</code> })}
          </p>
        )}
      </div>
    </div>
  );
}

