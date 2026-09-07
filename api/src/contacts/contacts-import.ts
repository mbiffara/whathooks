/**
 * The pure half of a bulk contact import: what to do with each row, given
 * what the book already holds. No Prisma here so it can be tested on its own
 * and the service around it stays a thin transaction.
 */

/** Hard ceiling per organization, shared by single create and bulk import. */
export const MAX_CONTACTS_PER_ORG = 5000;

export type ImportSkipReason =
  'invalid_phone' | 'duplicate_in_batch' | 'unknown_agent';

export interface ImportRow {
  phoneNumber: string;
  name?: string | null;
  humanAgentId?: string | null;
}

export interface ExistingContact {
  id: string;
  phoneNumber: string;
  name: string | null;
  humanAgentId: string | null;
}

export interface ImportPlan {
  toCreate: Array<{
    phoneNumber: string;
    name: string | null;
    humanAgentId: string | null;
  }>;
  toUpdate: Array<{
    id: string;
    data: { name?: string; humanAgentId?: string | null };
  }>;
  unchanged: number;
  /** `row` is the index within the posted batch. */
  skipped: Array<{ row: number; reason: ImportSkipReason }>;
}

/**
 * Digits with country code, or null when the cell cannot be a phone number.
 * Spreadsheets arrive with `+52 56 1058 8729`, `(55) 3445-3329`, or a bare
 * number that Excel stored as a float; all of those are the same contact.
 */
export function normalizePhone(raw: unknown): string | null {
  const text =
    typeof raw === 'number'
      ? String(Math.trunc(raw))
      : typeof raw === 'string'
        ? raw
        : null;
  if (text === null) return null;
  const digits = text.replace(/[^0-9]/g, '');
  if (digits.length < 5 || digits.length > 20) return null;
  return digits;
}

/** Trimmed, or null when blank. */
function cleanName(raw: string | null | undefined): string | null {
  const name = (raw ?? '').trim();
  return name || null;
}

/**
 * Decide, row by row, whether to create, update or leave a contact alone.
 *
 * - The first occurrence of a number in the batch wins; later ones are
 *   reported so the operator can fix the sheet.
 * - An existing contact takes the file's name and agent when they differ.
 *   The file is the operator's statement of who these people are, so it
 *   wins over whatever WhatsApp's push name left behind. A row with no name
 *   never blanks one.
 * - A row whose agent id the org does not own is skipped rather than
 *   imported without an agent: silently dropping the assignment is the one
 *   outcome the operator cannot see in the summary.
 */
export function planImport(
  rows: ImportRow[],
  existing: ExistingContact[],
  knownAgentIds: ReadonlySet<string>,
): ImportPlan {
  const byPhone = new Map(existing.map((c) => [c.phoneNumber, c] as const));
  const seen = new Set<string>();
  const plan: ImportPlan = {
    toCreate: [],
    toUpdate: [],
    unchanged: 0,
    skipped: [],
  };

  rows.forEach((row, index) => {
    const phoneNumber = normalizePhone(row.phoneNumber);
    if (!phoneNumber) {
      plan.skipped.push({ row: index, reason: 'invalid_phone' });
      return;
    }
    if (seen.has(phoneNumber)) {
      plan.skipped.push({ row: index, reason: 'duplicate_in_batch' });
      return;
    }
    seen.add(phoneNumber);

    const humanAgentId = row.humanAgentId?.trim() || null;
    if (humanAgentId && !knownAgentIds.has(humanAgentId)) {
      plan.skipped.push({ row: index, reason: 'unknown_agent' });
      return;
    }
    const name = cleanName(row.name);

    const current = byPhone.get(phoneNumber);
    if (!current) {
      plan.toCreate.push({ phoneNumber, name, humanAgentId });
      return;
    }
    const data: { name?: string; humanAgentId?: string | null } = {};
    if (name && name !== current.name) data.name = name;
    if (humanAgentId !== current.humanAgentId) data.humanAgentId = humanAgentId;
    if (Object.keys(data).length === 0) {
      plan.unchanged += 1;
      return;
    }
    plan.toUpdate.push({ id: current.id, data });
  });

  return plan;
}
