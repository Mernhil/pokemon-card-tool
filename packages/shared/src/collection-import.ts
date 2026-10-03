import { CONDITIONS, normalizeListingLanguage } from "./enums";
import { parseCsv } from "./csv";

/**
 * Reads a collection exported by another tracker (a Cardmarket stock export,
 * the TCGplayer app, Collectr, a hand-made spreadsheet, or our own export)
 * into plain rows. Columns are found by their header names; nothing here
 * touches the catalog — matching rows to cards is packages/db/src/collection-import.ts.
 */

export interface ImportRow {
  /** 1-based line in the file (the header is line 1). */
  line: number;
  name: string;
  /** Set name or code as the file spells it; may be empty. */
  set: string;
  number: string;
  quantity: number;
  /** true = holo / reverse / foil in some form, false = explicitly non-foil, null = not said. */
  foil: boolean | null;
  /** Our Finish if the file names it exactly ("HOLO", "Reverse Holofoil"), else null. */
  finish: string | null;
  condition: string | null;
  /** One of our language codes, null when absent or unknown. */
  language: string | null;
  /** Paid per card, major units. */
  paid: number | null;
}

type Field = "name" | "set" | "number" | "quantity" | "foil" | "finish" | "condition" | "language" | "paid";

const HEADERS: Record<Field, string[]> = {
  name: ["name", "card name", "product name", "card", "cardname"],
  set: ["set", "set name", "expansion", "expansion name", "edition", "set code"],
  number: ["number", "card number", "collector number", "card no", "no", "cardnumber", "#"],
  quantity: ["quantity", "qty", "amount", "count", "owned", "have"],
  foil: ["foil", "is foil", "holo"],
  finish: ["finish", "printing", "variance", "variant", "type"],
  condition: ["condition", "card condition", "cond"],
  language: ["language", "lang"],
  paid: ["paid per card", "price", "average cost paid", "purchase price", "cost", "paid", "price paid"],
};

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9# ]+/g, " ").replace(/\s+/g, " ").trim();

/** Header text -> column index per field (first match wins, exact names before partial). */
export function detectColumns(header: string[]): Partial<Record<Field, number>> {
  const names = header.map(clean);
  const found: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  for (const field of Object.keys(HEADERS) as Field[]) {
    const idx = names.findIndex((n, i) => !used.has(i) && HEADERS[field].includes(n));
    if (idx >= 0) {
      found[field] = idx;
      used.add(idx);
    }
  }
  return found;
}

const CONDITION_ALIASES: Array<[RegExp, string]> = [
  [/^(mint|m|gem mint)$/, "MINT"],
  [/^(near mint|nm|nm mt|nearmint|near mint foil)$/, "NEAR_MINT"],
  [/^(excellent|ex|lightly played|lp|slightly played|sp|good|gd)$/, "LIGHTLY_PLAYED"],
  [/^(moderately played|mp|played|pl|light played)$/, "MODERATELY_PLAYED"],
  [/^(heavily played|hp|poor|po)$/, "HEAVILY_PLAYED"],
  [/^(damaged|dmg|d)$/, "DAMAGED"],
];

export function normalizeCondition(raw: string): string | null {
  const v = clean(raw);
  if ((CONDITIONS as readonly string[]).includes(raw.trim().toUpperCase().replace(/ /g, "_")))
    return raw.trim().toUpperCase().replace(/ /g, "_");
  return CONDITION_ALIASES.find(([re]) => re.test(v))?.[1] ?? null;
}

/** "Reverse Holofoil" / "REVERSE_HOLO" -> REVERSE_HOLO etc.; unknown -> null. */
export function normalizeFinish(raw: string): string | null {
  const v = clean(raw).replace(/ /g, "");
  if (!v) return null;
  if (v.includes("reverse")) return "REVERSE_HOLO";
  if (v === "holo" || v === "holofoil" || v === "foil") return "HOLO";
  if (v === "normal" || v === "nonfoil" || v === "regular" || v === "unlimited") return "NON_FOIL";
  return null;
}

function parseFoil(raw: string): boolean | null {
  const v = clean(raw);
  if (!v) return null;
  if (["true", "yes", "y", "1", "foil", "x"].includes(v)) return true;
  if (["false", "no", "n", "0", "nonfoil", "non foil"].includes(v)) return false;
  return null;
}

function parseMoney(raw: string): number | null {
  const v = raw.replace(/[^0-9.,-]/g, "");
  if (!v) return null;
  // "1.234,56" or "12,5" (decimal comma) vs "1,234.56" / "12.50".
  const normalized =
    v.includes(",") && (!v.includes(".") || v.lastIndexOf(",") > v.lastIndexOf("."))
      ? v.replace(/\./g, "").replace(",", ".")
      : v.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface ParsedImport {
  rows: ImportRow[];
  /** Fields the file has a column for. */
  columns: Field[];
  /** Plain-language problems: missing columns, skipped lines. */
  warnings: string[];
}

export function parseCollectionCsv(text: string): ParsedImport {
  const table = parseCsv(text);
  const header = table[0];
  if (!header) return { rows: [], columns: [], warnings: ["The file is empty."] };
  const cols = detectColumns(header);
  const warnings: string[] = [];
  if (cols.name === undefined)
    warnings.push('No "Name" column found — the first row must name each column.');
  if (cols.number === undefined)
    warnings.push('No card number column ("Number", "Card Number"…) — cards can only be guessed by name.');
  if (cols.name === undefined) return { rows: [], columns: Object.keys(cols) as Field[], warnings };

  const rows: ImportRow[] = [];
  const get = (r: string[], f: Field) => (cols[f] === undefined ? "" : (r[cols[f]!] ?? "").trim());
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const name = get(r, "name");
    if (!name) return;
    const qty = Math.floor(Number(get(r, "quantity") || 1));
    if (!Number.isFinite(qty) || qty < 1) {
      warnings.push(`Line ${line}: "${name}" has quantity "${get(r, "quantity")}" — skipped.`);
      return;
    }
    const finishRaw = get(r, "finish");
    const finish = normalizeFinish(finishRaw);
    rows.push({
      line,
      name,
      set: get(r, "set"),
      number: get(r, "number"),
      quantity: Math.min(qty, 999),
      foil: parseFoil(get(r, "foil")) ?? (finish ? finish !== "NON_FOIL" : null),
      finish,
      condition: normalizeCondition(get(r, "condition")),
      language: normalizeListingLanguage(get(r, "language")),
      paid: parseMoney(get(r, "paid")),
    });
  });
  return { rows, columns: Object.keys(cols) as Field[], warnings };
}
