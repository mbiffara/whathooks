/**
 * Webhook payload projection. When a webhook has mapping rules, the delivered
 * `data` object is built ONLY from those rules (the envelope — event,
 * sessionId, timestamp — is unchanged). Each rule produces one output field:
 *
 *   { target: "phone",      source: "data.from" }                 // rename
 *   { target: "receivedAt", source: "data.timestamp",
 *     dateFormat: "yyyy-MM-dd HH:mm" }                            // date
 *   { target: "origin",     value: "whathooks" }                  // fixed
 *
 * `source` is a dot path resolved against the full envelope, so `data.*`,
 * `event`, `sessionId`, and `timestamp` are all addressable. A missing source
 * simply omits the field. Date formats: "iso", "unix", "unix_ms", or a token
 * pattern using yyyy MM dd HH mm ss (rendered in UTC).
 */

export interface MappingRule {
  /** Output field name in the delivered `data` object. */
  target: string;
  /** Dot path into the event envelope, e.g. "data.from". */
  source?: string;
  /** Fixed value delivered as-is (mutually exclusive with source). */
  value?: string | number | boolean | null;
  /** When set, the source value is parsed as a date and formatted. */
  dateFormat?: string;
}

export const TARGET_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
export const SOURCE_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
export const MAX_MAPPING_RULES = 50;

/** Validate rules at write time; returns an error message or null when ok. */
export function mappingRulesError(rules: MappingRule[]): string | null {
  if (rules.length > MAX_MAPPING_RULES) {
    return `At most ${MAX_MAPPING_RULES} mapping rules are allowed`;
  }
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!TARGET_RE.test(rule.target)) {
      return `Invalid target field name "${rule.target}"`;
    }
    if (seen.has(rule.target)) {
      return `Duplicate target field "${rule.target}"`;
    }
    seen.add(rule.target);
    const hasSource = rule.source !== undefined;
    const hasValue = rule.value !== undefined;
    if (hasSource === hasValue) {
      return `Field "${rule.target}" needs exactly one of source or value`;
    }
    if (hasSource && !SOURCE_RE.test(rule.source!)) {
      return `Invalid source path for "${rule.target}"`;
    }
    if (rule.dateFormat !== undefined && !hasSource) {
      return `dateFormat on "${rule.target}" requires a source`;
    }
  }
  return null;
}

/** Cheap structural check for values loaded back from the Json column. */
export function isMappingRules(value: unknown): value is MappingRule[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (r) =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as MappingRule).target === 'string',
    )
  );
}

/** Build the projected `data` object for a delivery. Never throws. */
export function applyPayloadMapping(
  rules: MappingRule[],
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rule of rules) {
    if (rule.source === undefined) {
      out[rule.target] = rule.value ?? null;
      continue;
    }
    const raw = getPath(envelope, rule.source);
    if (raw === undefined) continue; // missing source → field omitted
    out[rule.target] = rule.dateFormat ? formatDate(raw, rule.dateFormat) : raw;
  }
  return out;
}

function getPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Format a date-ish value (unix seconds, unix millis, ISO string, Date).
 * Presets: "iso", "unix", "unix_ms". Anything else is a token pattern over
 * yyyy MM dd HH mm ss, rendered in UTC. Unparseable input passes through.
 */
export function formatDate(value: unknown, format: string): unknown {
  const date = toDate(value);
  if (!date) return value;

  switch (format) {
    case 'iso':
      return date.toISOString();
    case 'unix':
      return Math.floor(date.getTime() / 1000);
    case 'unix_ms':
      return date.getTime();
  }

  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return format
    .replace(/yyyy/g, String(date.getUTCFullYear()))
    .replace(/MM/g, pad(date.getUTCMonth() + 1))
    .replace(/dd/g, pad(date.getUTCDate()))
    .replace(/HH/g, pad(date.getUTCHours()))
    .replace(/mm/g, pad(date.getUTCMinutes()))
    .replace(/ss/g, pad(date.getUTCSeconds()));
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Heuristic: unix seconds until ~year 33658, millis after.
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
