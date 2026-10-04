/** One CSV field, quoted when needed. Also defuses spreadsheet formulas (=, +, -, @ at the start). */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(
  header: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/**
 * Parses CSV text (RFC 4180 quoting; the delimiter, "," ";" or tab, is
 * guessed from the header line; a BOM is ignored) into rows of fields.
 * Blank lines are dropped.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0]![0];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((f) => f.trim() !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) endField();
    else if (c === "\n") endRow();
    else if (c === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
    } else field += c;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
