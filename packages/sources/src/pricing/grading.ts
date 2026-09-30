/**
 * Reads a graded slab out of a listing title: who graded it, which grade, and
 * the premium tier some companies add on top of a 10 (BGS Black Label, BGS/CGC/
 * TAG Pristine). Pure and unit-tested; titles are messy, so when in doubt it
 * says "not graded" (null) and the listing is left out.
 */

export const GRADING_COMPANY_IDS = ["PSA", "BGS", "CGC", "SGC", "TAG", "ACE"] as const;
export type GradingCompanyId = (typeof GRADING_COMPANY_IDS)[number];

/** "" is the standard grade; the others only exist at the top of a company's scale. */
export type GradeTier = "" | "pristine" | "black-label";

export interface GradedTitle {
  company: GradingCompanyId;
  /** 1 to 10, in steps of 0.5. */
  grade: number;
  tier: GradeTier;
}

const COMPANY_WORDS: Array<[GradingCompanyId, RegExp]> = [
  ["PSA", /\bpsa\b/i],
  ["BGS", /\b(bgs|beckett)\b/i],
  ["CGC", /\bcgc\b/i],
  ["SGC", /\bsgc\b/i],
  ["TAG", /\btag\b/i],
  ["ACE", /\bace\b/i],
];

// Words that may sit between the company and the number: "PSA GEM MINT 10", "CGC Pristine 10".
const FILLER =
  "(?:gem|mint|nm|mt|near|pristine|perfect|black|label|graded|grade|gold|silver|card|pokemon|no|number|#|:|-|\\s)*?";

/** The number right after a company word, as a grade (never part of a "001/064" card number). */
function gradeAfter(title: string, company: RegExp): number | null {
  const source = company.source.replace(/^\\b/, "").replace(/\\b$/, "");
  const re = new RegExp(`\\b${source}\\b${FILLER}(\\d{1,2}(?:\\.\\d)?)(?![\\d/.]|\\s*/)`, "i");
  const m = title.match(re);
  if (!m) return null;
  const grade = Number(m[m.length - 1]);
  return grade >= 1 && grade <= 10 && Number.isInteger(grade * 2) ? grade : null;
}

export function parseGradedTitle(title: string): GradedTitle | null {
  for (const [company, pattern] of COMPANY_WORDS) {
    if (!pattern.test(title)) continue;
    const grade = gradeAfter(title, pattern);
    if (grade === null) continue;
    let tier: GradeTier = "";
    if (grade === 10) {
      if (/black\s*label|\bbl\b/i.test(title) && company === "BGS") tier = "black-label";
      else if (/pristine/i.test(title) && (company === "BGS" || company === "CGC" || company === "TAG"))
        tier = "pristine";
    }
    return { company, grade, tier };
  }
  return null;
}

/** Stable key for a grade column: "10", "10:pristine", "10:black-label", "9.5". */
export function gradeKey(grade: number, tier: GradeTier): string {
  return tier ? `${grade}:${tier}` : String(grade);
}

export function parseGradeKey(key: string): { grade: number; tier: GradeTier } {
  const [g, tier] = key.split(":");
  return { grade: Number(g), tier: (tier as GradeTier | undefined) ?? "" };
}

export const TIER_LABELS: Record<GradeTier, string> = {
  "": "",
  pristine: "Pristine",
  "black-label": "Black Label",
};

/** "10 Black Label", "9.5", "10 Pristine". */
export function gradeLabel(key: string): string {
  const { grade, tier } = parseGradeKey(key);
  return tier ? `${grade} ${TIER_LABELS[tier]}` : String(grade);
}

/** Columns high to low, premium tiers before the plain grade of the same number. */
export function compareGradeKeys(a: string, b: string): number {
  const x = parseGradeKey(a);
  const y = parseGradeKey(b);
  if (x.grade !== y.grade) return y.grade - x.grade;
  const rank = (t: GradeTier) => (t === "black-label" ? 0 : t === "pristine" ? 1 : 2);
  return rank(x.tier) - rank(y.tier);
}
