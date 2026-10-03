/**
 * Webcam scanning reads the printed collector number off a card ("025/198",
 * "TG01/TG30", "SVP 123"). OCR is noisy, so this turns its raw text into the
 * few plausible numbers, best first. Pure, so the rules are tested here.
 */

export interface ScannedNumber {
  /** As read, e.g. "025" or "TG01". */
  number: string;
  /** The set total after the slash, when read ("198"), else null. */
  total: string | null;
}

/** OCR confuses these inside digit runs. */
const DIGIT_FIXES: Record<string, string> = { O: "0", o: "0", I: "1", l: "1", "|": "1", S: "5", B: "8" };

const fixDigits = (s: string) => s.replace(/[OolI|SB]/g, (c) => DIGIT_FIXES[c] ?? c);

export function parseScannedNumbers(text: string): ScannedNumber[] {
  const found: ScannedNumber[] = [];
  const seen = new Set<string>();
  const add = (number: string, total: string | null) => {
    const key = `${number.toUpperCase()}/${total ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ number: number.toUpperCase(), total });
  };
  // "025/198", "TG01/TG30", "SWSH 123/SWSH" style: a number, a slash, a total.
  const slashed = /([A-Za-z]{0,5}\s?[0-9OolI|SB]{1,3})\s*[\/\\]\s*([A-Za-z]{0,5}[0-9OolI|SB]{1,3})/g;
  const repair = (token: string) =>
    /^[0-9OolI|SB]+$/.test(token)
      ? fixDigits(token)
      : (() => {
          const prefix = /^[A-Za-z]{2,}/.exec(token)?.[0] ?? "";
          return prefix + fixDigits(token.slice(prefix.length));
        })();
  for (const m of text.matchAll(slashed)) {
    const num = repair(m[1]!.replace(/\s+/g, ""));
    const total = repair(m[2]!);
    if (/\d/.test(num)) add(num, total);
  }
  // Promo numbers without a slash: "SVP 123", "SWSH123", "XY45" (not the ones already read above).
  const rest = text.replace(slashed, " ");
  for (const m of rest.matchAll(/\b([A-Za-z]{2,5})\s?([0-9]{1,3})\b/g)) {
    if (/^(HP|LV|PSA|BGS)$/i.test(m[1]!)) continue;
    add(`${m[1]}${m[2]}`, null);
  }
  return found;
}
