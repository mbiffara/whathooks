"use client";

import { apiClient } from "@/lib/client-api";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

/**
 * Import a spreadsheet (xlsx, xls, csv) into the contact book.
 *
 * The browser reads the file: the operator sees which columns were picked,
 * which agent each label maps to, and what will be skipped, before a single
 * row leaves their machine. Rows then go to the API in batches, so a sheet
 * with thousands of contacts is a progress bar rather than one long request.
 */

interface AgentOption {
  id: string;
  name: string;
}

interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: Array<{ row: number; reason: string }>;
}

interface ParsedSheet {
  header: string[];
  /** 0-based index of the header row in the sheet. */
  headerRow: number;
  rows: string[][];
}

type Step = "pick" | "map" | "importing" | "done";

const CHUNK = 500;
const PHONE_HEADER =
  /^(numero|número|number|phone|tel|telefono|teléfono|whatsapp|celular|móvil|movil)/i;
const NAME_HEADER = /^(nombre|name|contacto|contact|cliente)/i;
const LABEL_HEADER =
  /^(etiqueta|agente|agent|asesor|vendedor|owner|label|responsable)/i;

/** Lowercase, no diacritics, trimmed: how labels and agent names compare. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

function digitsOf(cell: string): string {
  return cell.replace(/[^0-9]/g, "");
}

/** Cell text: whole numbers for numeric cells, trimmed text otherwise. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(Math.trunc(v));
  return String(v).trim();
}

/** The header is the first row that names a phone column, else the first row with two filled cells. */
function findHeader(rows: string[][]): number {
  const filled = (r: string[]) => r.filter(Boolean).length >= 2;
  const byName = rows.findIndex(
    (r) => filled(r) && r.some((c) => PHONE_HEADER.test(c)),
  );
  if (byName >= 0) return byName;
  return rows.findIndex(filled);
}

/** Pick the agent a label most plausibly means, or "" when nothing fits. */
function guessAgent(label: string, agents: AgentOption[]): string {
  const l = fold(label);
  if (!l) return "";
  const exact = agents.find((a) => fold(a.name) === l);
  if (exact) return exact.id;
  const first = agents.filter((a) => fold(a.name).split(/\s+/)[0] === l);
  if (first.length === 1) return first[0].id;
  const starts = agents.filter((a) => fold(a.name).startsWith(l));
  if (starts.length === 1) return starts[0].id;
  return "";
}

export function ContactsImportDialog({
  token,
  agents,
  onClose,
  onDone,
}: {
  token: string | undefined;
  agents: AgentOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("dash.contacts.importDialog");
  const tc = useTranslations("common");
  const [step, setStep] = useState<Step>("pick");
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [phoneCol, setPhoneCol] = useState(-1);
  const [nameCol, setNameCol] = useState(-1);
  const [labelCol, setLabelCol] = useState(-1);
  const [agentByLabel, setAgentByLabel] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);

  async function pickFile(file: File) {
    setError(null);
    try {
      // Loaded on demand: the contact book itself never needs a parser.
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error(t("sheetEmpty"));
      // raw: true keeps a numeric phone cell as a number instead of Excel's
      // "5.2561E+11" display text.
      const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        raw: true,
        defval: "",
      });
      const rows = grid.map((r) => r.map(cellText));
      const headerRow = findHeader(rows);
      if (headerRow < 0) throw new Error(t("noHeader"));
      const header = rows[headerRow];
      const body = rows
        .slice(headerRow + 1)
        .filter((r) => r.some((c) => c !== ""));
      const parsed: ParsedSheet = { header, headerRow, rows: body };
      setSheet(parsed);
      const col = (re: RegExp) => header.findIndex((h) => re.test(h));
      const phone = col(PHONE_HEADER);
      setPhoneCol(phone >= 0 ? phone : 0);
      setNameCol(col(NAME_HEADER));
      const label = col(LABEL_HEADER);
      setLabelCol(label);
      setAgentByLabel(
        label >= 0
          ? Object.fromEntries(
              [...new Set(body.map((r) => r[label] ?? "").filter(Boolean))].map(
                (l) => [l, guessAgent(l, agents)],
              ),
            )
          : {},
      );
      setStep("map");
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
    }
  }

  const labels = useMemo(() => {
    if (!sheet || labelCol < 0) return [] as string[];
    return [
      ...new Set(sheet.rows.map((r) => r[labelCol] ?? "").filter(Boolean)),
    ];
  }, [sheet, labelCol]);

  // Re-guess when the operator changes which column holds the label.
  function chooseLabelCol(col: number) {
    setLabelCol(col);
    if (!sheet || col < 0) return setAgentByLabel({});
    const next = [
      ...new Set(sheet.rows.map((r) => r[col] ?? "").filter(Boolean)),
    ];
    setAgentByLabel(
      Object.fromEntries(next.map((l) => [l, guessAgent(l, agents)])),
    );
  }

  /** What will be posted, plus what the preview counts. */
  const prepared = useMemo(() => {
    if (!sheet || phoneCol < 0) return null;
    const seen = new Set<string>();
    // Rejected here, before anything is posted; they join the final summary
    // so the operator gets the row numbers to fix, not just a count.
    const rejected: Array<{ row: number; reason: string }> = [];
    const rows: Array<{
      sheetRow: number;
      phoneNumber: string;
      name?: string;
      humanAgentId?: string;
    }> = [];
    sheet.rows.forEach((r, i) => {
      const phone = r[phoneCol] ?? "";
      const digits = digitsOf(phone);
      const sheetRow = sheet.headerRow + 2 + i;
      if (digits.length < 5 || digits.length > 20) {
        rejected.push({ row: sheetRow, reason: "invalid_phone" });
        return;
      }
      if (seen.has(digits)) {
        rejected.push({ row: sheetRow, reason: "duplicate_in_batch" });
        return;
      }
      seen.add(digits);
      const label = labelCol >= 0 ? (r[labelCol] ?? "") : "";
      const agentId = label ? agentByLabel[label] : "";
      rows.push({
        sheetRow,
        phoneNumber: phone,
        ...(nameCol >= 0 && r[nameCol] ? { name: r[nameCol] } : {}),
        ...(agentId ? { humanAgentId: agentId } : {}),
      });
    });
    const unmatched = labels.filter((l) => !agentByLabel[l]).length;
    const invalid = rejected.filter((x) => x.reason === "invalid_phone").length;
    const duplicates = rejected.length - invalid;
    return { rows, rejected, invalid, duplicates, unmatched };
  }, [sheet, phoneCol, nameCol, labelCol, agentByLabel, labels]);

  async function start() {
    if (!prepared || !token) return;
    setStep("importing");
    setError(null);
    const total = Math.ceil(prepared.rows.length / CHUNK);
    setProgress({ done: 0, total });
    const totals: ImportResult = {
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: [...prepared.rejected],
    };
    for (let i = 0; i < total; i++) {
      const slice = prepared.rows.slice(i * CHUNK, (i + 1) * CHUNK);
      try {
        const r = await apiClient<ImportResult>("/contacts/bulk", token, {
          method: "POST",
          body: JSON.stringify({
            rows: slice.map(({ phoneNumber, name, humanAgentId }) => ({
              phoneNumber,
              name,
              humanAgentId,
            })),
          }),
        });
        totals.created += r.created;
        totals.updated += r.updated;
        totals.unchanged += r.unchanged;
        // Report the row as the operator sees it in their spreadsheet.
        totals.skipped.push(
          ...r.skipped.map((s) => ({
            row: slice[s.row]?.sheetRow ?? s.row,
            reason: s.reason,
          })),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
        break;
      }
      setProgress({ done: i + 1, total });
    }
    totals.skipped.sort((a, b) => a.row - b.row);
    setResult(totals);
    setStep("done");
    onDone();
  }

  const colSelect = (
    value: number,
    onChange: (col: number) => void,
    allowNone: boolean,
  ) => (
    <select
      className="input"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {allowNone && <option value={-1}>{t("ignoreColumn")}</option>}
      {sheet?.header.map((h, i) => (
        <option key={i} value={i}>
          {h || `#${i + 1}`}
        </option>
      ))}
    </select>
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="contacts-import-title"
      onClick={step === "importing" ? undefined : onClose}
    >
      <div
        className="card flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="contacts-import-title" className="text-lg font-semibold">
          {t("title")}
        </h2>

        {step === "pick" && (
          <>
            <p className="text-sm text-[var(--color-muted)]">{t("fileHint")}</p>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickFile(f);
              }}
            />
          </>
        )}

        {step === "map" && sheet && prepared && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                {t("colPhone")}
                {colSelect(phoneCol, setPhoneCol, false)}
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("colName")}
                {colSelect(nameCol, setNameCol, true)}
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("colLabel")}
                {colSelect(labelCol, chooseLabelCol, true)}
              </label>
            </div>

            {labels.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-sm font-medium">{t("labelMapping")}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {labels.map((l) => {
                    const chosen = agentByLabel[l] ?? "";
                    return (
                      <label
                        key={l}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span
                          className={chosen ? "" : "text-[var(--color-danger)]"}
                        >
                          {l}
                        </span>
                        <select
                          className="input w-48"
                          value={chosen}
                          onChange={(e) =>
                            setAgentByLabel((m) => ({
                              ...m,
                              [l]: e.target.value,
                            }))
                          }
                        >
                          <option value="">{t("withoutAgent")}</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
                {prepared.unmatched > 0 && (
                  <p className="text-xs text-[var(--color-danger)]">
                    {t("unmatched", { count: prepared.unmatched })}
                  </p>
                )}
              </div>
            )}

            <div className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  {t("previewValid", { count: prepared.rows.length })}
                </span>
                {prepared.invalid > 0 && (
                  <span className="text-[var(--color-danger)]">
                    {t("previewInvalid", { count: prepared.invalid })}
                  </span>
                )}
                {prepared.duplicates > 0 && (
                  <span className="text-[var(--color-muted)]">
                    {t("previewDuplicates", { count: prepared.duplicates })}
                  </span>
                )}
              </div>
              {prepared.rows.length > 0 && (
                <table className="mt-2 w-full text-xs">
                  <tbody>
                    {prepared.rows.slice(0, 5).map((r) => (
                      <tr key={r.sheetRow}>
                        <td className="py-0.5 pr-3 font-mono">
                          +{digitsOf(r.phoneNumber)}
                        </td>
                        <td className="py-0.5 pr-3">{r.name ?? ""}</td>
                        <td className="py-0.5 text-[var(--color-muted)]">
                          {agents.find((a) => a.id === r.humanAgentId)?.name ??
                            ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-2 text-xs text-[var(--color-muted)]">
                {t("webhookNote")}
              </p>
            </div>
          </>
        )}

        {step === "importing" && (
          <div className="flex flex-col gap-2 text-sm">
            <span>
              {t("progress", { done: progress.done, total: progress.total })}
            </span>
            <div className="h-2 overflow-hidden rounded bg-[var(--color-border)]">
              <div
                className="h-full bg-[var(--color-brand)] transition-all"
                style={{
                  width: `${progress.total ? (100 * progress.done) / progress.total : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>{t("resultCreated", { count: result.created })}</span>
              <span>{t("resultUpdated", { count: result.updated })}</span>
              <span className="text-[var(--color-muted)]">
                {t("resultUnchanged", { count: result.unchanged })}
              </span>
            </div>
            {result.skipped.length > 0 && (
              <div>
                <div className="text-[var(--color-danger)]">
                  {t("resultSkipped", { count: result.skipped.length })}
                </div>
                <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-[var(--color-muted)]">
                  {result.skipped.slice(0, 50).map((s, i) => (
                    <li key={i}>
                      {t("rowLabel", { row: s.row })}: {t(`reason.${s.reason}`)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

        <div className="flex justify-end gap-3">
          {step === "map" && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="btn-ghost text-sm"
              >
                {tc("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void start()}
                disabled={!prepared || prepared.rows.length === 0}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {t("start", { count: prepared?.rows.length ?? 0 })}
              </button>
            </>
          )}
          {(step === "pick" || step === "done") && (
            <button
              type="button"
              onClick={onClose}
              className="btn-primary text-sm"
            >
              {step === "done" ? tc("close") : tc("cancel")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
