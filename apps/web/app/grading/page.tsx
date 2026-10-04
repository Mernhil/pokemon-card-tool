import Link from "next/link";
import { gradingCandidates, type GradingVerdict } from "@tcg-vault/db";
import { GRADING_COMPANIES } from "@tcg-vault/shared";
import { formatEur } from "../../components/money";
import { buttonClass } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/page-header";
import { cardHref } from "../../lib/cards";
import { loadMoneyDisplay } from "../../lib/money-config";

export const dynamic = "force-dynamic";

const VERDICTS: Record<GradingVerdict, { label: string; className: string }> = {
  send: { label: "Worth sending", className: "bg-emerald-100 text-emerald-800" },
  gamble: { label: "Only at a 10", className: "bg-amber-100 text-amber-800" },
  skip: { label: "Not worth it", className: "bg-neutral-100 text-neutral-600" },
  unknown: { label: "No graded prices", className: "bg-neutral-100 text-neutral-500" },
};

const signed = (n: number | null) =>
  n === null ? "—" : `${n < 0 ? "−" : "+"}${formatEur(Math.abs(n))}`;

/** Raw cards you own against graded asking prices, minus what grading costs. */
export default async function GradingPage({
  searchParams,
}: {
  searchParams: { company?: string; fee?: string };
}) {
  await loadMoneyDisplay();
  const company = (GRADING_COMPANIES as readonly string[]).includes(searchParams.company ?? "")
    ? searchParams.company!
    : "PSA";
  const feeInput = Number(searchParams.fee ?? 25);
  const fee = Number.isFinite(feeInput) && feeInput >= 0 ? feeInput : 25;
  const rows = await gradingCandidates(company, fee);
  const priced = rows.filter((r) => r.verdict !== "unknown");

  return (
    <main className="page max-w-5xl">
      <PageHeader
        eyebrow="Portfolio"
        title="Grading helper"
        subtitle="Your ungraded cards: near-mint value against what graded copies are listed for, minus the cost of grading one."
      />
      <form className="panel mb-5 flex flex-wrap items-end gap-3 p-4" method="get">
        <label className="label">
          Company
          <select name="company" defaultValue={company} className="field py-1.5">
            {["PSA", "BGS", "CGC", "SGC", "TAG", "ACE"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="label">
          Cost per card (€, grading + shipping + insurance)
          <input name="fee" type="number" min={0} step={1} defaultValue={fee} className="field w-28 py-1.5" />
        </label>
        <button type="submit" className={buttonClass("primary", "md")}>
          Update
        </button>
      </form>
      <p className="mb-4 text-xs text-neutral-500">
        Graded numbers are eBay <em>asking</em> prices, usually above what slabs really sell for, and
        only exist for cards whose page you opened with eBay keys set (Settings). “Worth sending”
        means it pays off even at a grade 9; the grade itself is never guaranteed.
      </p>
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">
          You have no ungraded cards with a value yet.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-neutral-600">
            {priced.length} of {rows.length} cards have {company} prices.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-neutral-500">
                <tr>
                  <th className="py-1 pr-3">Card</th>
                  <th className="py-1 pr-3 text-right">Raw</th>
                  <th className="py-1 pr-3 text-right">{company} 10</th>
                  <th className="py-1 pr-3 text-right">{company} 9</th>
                  <th className="py-1 pr-3 text-right">Gain at 10</th>
                  <th className="py-1 pr-3 text-right">Gain at 9</th>
                  <th className="py-1">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.variantId} className="border-t">
                    <td className="py-1.5 pr-3">
                      <Link
                        href={cardHref(r.gameSlug, r.setCode, r.collectorNumber)}
                        className="hover:text-accent"
                      >
                        {r.name} <span className="text-neutral-500">{r.collectorNumber}</span>
                      </Link>
                      <span className="block text-xs text-neutral-500">
                        {r.setName}
                        {r.copies > 1 ? ` · ${r.copies} copies` : ""}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatEur(r.rawEur)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {r.tenEur === null ? "—" : formatEur(r.tenEur)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {r.nineEur === null ? "—" : formatEur(r.nineEur)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{signed(r.gain10)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{signed(r.gain9)}</td>
                    <td className="py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${VERDICTS[r.verdict].className}`}>
                        {VERDICTS[r.verdict].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
