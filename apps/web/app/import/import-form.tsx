"use client";

import type { ImportCandidate, MatchedImportRow } from "@tcg-vault/db";
import { CONDITIONS } from "@tcg-vault/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { finishLabel } from "../../components/money";
import { Button } from "../../components/ui/button";
import { useToast } from "../../components/ui/toast";
import { commitImportAction, previewImportAction, type ImportPreview } from "./actions";

/** Per row: the candidate picked (variantId) or "" to skip it. */
type Choices = Record<number, string>;

const label = (c: ImportCandidate) =>
  `${c.name} ${c.number} · ${c.setName} · ${finishLabel(c.finish)}${c.languageCode === "en" ? "" : ` · ${c.languageCode}`} (${Math.round(c.score * 100)}%)`;

export function ImportForm() {
  const router = useRouter();
  const toast = useToast();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choices, setChoices] = useState<Choices>({});
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");

  const load = async (file: File) => {
    setBusy(true);
    setFileName(file.name);
    const result = await previewImportAction(await file.text());
    setBusy(false);
    if (!result.ok) {
      setPreview(null);
      toast("error", result.error);
      return;
    }
    setPreview(result.preview);
    // Sure matches are pre-selected; uncertain rows wait for a choice.
    setChoices(
      Object.fromEntries(
        result.preview.rows.map((m) => [
          m.row.line,
          m.status === "matched" ? m.candidates[0]!.variantId : "",
        ]),
      ),
    );
  };

  const rows = preview?.rows ?? [];
  const selected = rows.filter((m) => choices[m.row.line]);
  const copies = selected.reduce((s, m) => s + m.row.quantity, 0);
  const counts = {
    matched: rows.filter((m) => m.status === "matched").length,
    review: rows.filter((m) => m.status === "review").length,
    none: rows.filter((m) => m.status === "none").length,
  };

  const save = async () => {
    setBusy(true);
    const result = await commitImportAction(
      selected.map((m) => ({
        variantId: choices[m.row.line]!,
        quantity: m.row.quantity,
        condition: m.row.condition,
        paid: m.row.paid,
      })),
    );
    setBusy(false);
    if (!result.ok) return toast("error", result.error);
    toast("success", `Added ${result.copies} cop${result.copies === 1 ? "y" : "ies"} to your collection`);
    router.push("/collection");
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="panel p-5">
        <label className="flex flex-col gap-2 text-sm">
          CSV file
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
            }}
          />
        </label>
        <p className="mt-2 text-xs text-neutral-500">
          Columns are found by their names: Name, Set, Number, Quantity, Condition, Foil or Finish,
          Language, Price. Only Pokémon cards are matched for now. Nothing is saved until you press
          Import.
        </p>
      </section>

      {preview ? (
        <section className="panel p-5">
          <p className="text-sm">
            <strong>{fileName}</strong>: {rows.length} rows. {counts.matched} matched,{" "}
            {counts.review} need a choice, {counts.none} not found.
            {preview.truncated ? " Only the first 5,000 rows were read." : ""}
          </p>
          {preview.warnings.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
              {preview.warnings.slice(0, 8).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-neutral-500">
                <tr>
                  <th className="py-1 pr-3">Line</th>
                  <th className="py-1 pr-3">In the file</th>
                  <th className="py-1 pr-3">Qty</th>
                  <th className="py-1">Card</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m: MatchedImportRow) => (
                  <tr key={m.row.line} className="border-t align-top">
                    <td className="py-1.5 pr-3 tabular-nums text-neutral-400">{m.row.line}</td>
                    <td className="py-1.5 pr-3">
                      {m.row.name}
                      <span className="block text-xs text-neutral-500">
                        {[m.row.set, m.row.number, m.row.condition && conditionText(m.row.condition)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">{m.row.quantity}</td>
                    <td className="py-1.5">
                      {m.candidates.length === 0 ? (
                        <span className="text-red-600">No match in the catalog</span>
                      ) : (
                        <select
                          className="field w-full max-w-md py-1 text-sm"
                          value={choices[m.row.line] ?? ""}
                          aria-label={`Card for line ${m.row.line}`}
                          onChange={(e) =>
                            setChoices((c) => ({ ...c, [m.row.line]: e.target.value }))
                          }
                        >
                          <option value="">
                            {m.status === "review" ? "Choose a card…" : "Skip this row"}
                          </option>
                          {m.candidates.map((c) => (
                            <option key={c.variantId} value={c.variantId}>
                              {label(c)}
                            </option>
                          ))}
                        </select>
                      )}
                      {m.status === "matched" ? null : m.candidates[0]?.reason ? (
                        <span className="block text-xs text-neutral-500">{m.candidates[0].reason}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button onClick={() => void save()} disabled={busy || selected.length === 0}>
              Import {copies} card{copies === 1 ? "" : "s"}
            </Button>
            <span className="text-xs text-neutral-500">
              {rows.length - selected.length} rows will be skipped. Condition defaults to near mint
              when the file has none.
            </span>
          </div>
        </section>
      ) : null}
    </div>
  );
}

const conditionText = (c: string) =>
  (CONDITIONS as readonly string[]).includes(c) ? c.replaceAll("_", " ").toLowerCase() : c;
