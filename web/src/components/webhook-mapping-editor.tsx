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

const ENVELOPE_PATHS = ["event", "sessionId", "timestamp"];

/** Source paths offered per event (free text is also allowed). */
const SOURCE_SUGGESTIONS: Record<string, string[]> = {
  "message.received": [
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
    ...ENVELOPE_PATHS,
  ],
  "contact.created": [
    "data.id",
    "data.name",
    "data.phoneNumber",
    "data.lid",
    "data.company",
    "data.email",
    "data.website",
    "data.instagram",
    "data.notes",
    "data.createdAt",
    ...ENVELOPE_PATHS,
  ],
  "session.status": ["data.sessionId", "data.status", ...ENVELOPE_PATHS],
};
SOURCE_SUGGESTIONS["contact.updated"] = SOURCE_SUGGESTIONS["contact.created"];
SOURCE_SUGGESTIONS["session.qr"] = SOURCE_SUGGESTIONS["session.status"];

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

/** Stored payloadMapping (keyed object, or legacy array = message.received). */
export type EventMappings = Record<string, MappingRule[]>;

/** Mirror of the API's normalizeMappings for values read back from it. */
export function normalizeMappings(value: unknown): EventMappings {
  if (Array.isArray(value)) {
    return value.length ? { "message.received": value as MappingRule[] } : {};
  }
  if (value && typeof value === "object") {
    const out: EventMappings = {};
    for (const [event, rules] of Object.entries(value)) {
      if (Array.isArray(rules) && rules.length) {
        out[event] = rules as MappingRule[];
      }
    }
    return out;
  }
  return {};
}

/** Editor state for a webhook: one row list per subscribed event. */
export function mappingsToRowsByEvent(
  payloadMapping: unknown,
  events: string[],
): Record<string, RuleRow[]> {
  const mappings = normalizeMappings(payloadMapping);
  const out: Record<string, RuleRow[]> = {};
  for (const event of events) {
    out[event] = rulesToRows(mappings[event] ?? null);
  }
  return out;
}

/** Back to the wire shape; events without complete rules are dropped. */
export function rowsByEventToMappings(
  rowsByEvent: Record<string, RuleRow[]>,
): EventMappings {
  const out: EventMappings = {};
  for (const [event, rows] of Object.entries(rowsByEvent)) {
    const rules = rowsToRules(rows);
    if (rules.length) out[event] = rules;
  }
  return out;
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
  event,
  rows,
  onChange,
}: {
  /** Which event these rules project — selects the field suggestions. */
  event: string;
  rows: RuleRow[];
  onChange: (rows: RuleRow[]) => void;
}) {
  const t = useTranslations("dash.webhooks");
  const datalistId = `wh-source-paths-${event.replace(/\W/g, "-")}`;
  function patch(i: number, changes: Partial<RuleRow>) {
    onChange(rows.map((row, j) => (j === i ? { ...row, ...changes } : row)));
  }

  return (
    <div className="flex flex-col gap-2">
      <datalist id={datalistId}>
        {(SOURCE_SUGGESTIONS[event] ?? ENVELOPE_PATHS).map((p) => (
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
                placeholder={SOURCE_SUGGESTIONS[event]?.[1] ?? "data.from"}
                list={datalistId}
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

