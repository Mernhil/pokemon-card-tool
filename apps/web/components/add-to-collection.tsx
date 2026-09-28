"use client";

import { CONDITIONS, GRADING_COMPANIES } from "@tcg-vault/shared/src/enums";
import { ChevronDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addToCollectionAction } from "../app/actions";
import { finishLabel, formatEur } from "./money";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";

const CONDITION_LABEL: Record<string, string> = {
  MINT: "Mint",
  NEAR_MINT: "Near mint",
  LIGHTLY_PLAYED: "Lightly played",
  MODERATELY_PLAYED: "Moderately played",
  HEAVILY_PLAYED: "Heavily played",
  DAMAGED: "Damaged",
};

/**
 * "+ Add" in one click (near mint, 1 copy, chosen finish), with the rest —
 * quantity, condition, grading, price paid, notes — under "More options".
 */
export function AddToCollection({
  cardName,
  variants,
}: {
  cardName: string;
  variants: Array<{ id: string; finish: string; value: number | null }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [more, setMore] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState("NEAR_MINT");
  const [grading, setGrading] = useState("");
  const [grade, setGrade] = useState("");
  const [paid, setPaid] = useState("");
  const [notes, setNotes] = useState("");
  const variant = variants.find((v) => v.id === variantId);

  const submit = () =>
    start(async () => {
      const res = await addToCollectionAction({
        variantId,
        quantity: more ? quantity : 1,
        condition: more ? condition : "NEAR_MINT",
        gradingCompany: more ? grading || null : null,
        grade: more && grade ? Number(grade) : null,
        pricePaid: more && paid ? Number(paid.replace(",", ".")) : null,
        notes: more ? notes : null,
      });
      if (!res.ok) {
        toast("error", res.error);
        return;
      }
      const n = more ? quantity : 1;
      toast(
        "success",
        `Added ${n > 1 ? `${n}× ` : ""}${cardName} (${finishLabel(variant?.finish ?? "")})`,
      );
      setMore(false);
      setQuantity(1);
      setPaid("");
      setNotes("");
      router.refresh();
    });

  return (
    <form
      className="panel p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {variants.length > 1 ? (
          <div
            role="radiogroup"
            aria-label="Finish"
            className="flex flex-wrap gap-1 rounded-lg bg-surface-2 p-0.5"
          >
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={v.id === variantId}
                onClick={() => setVariantId(v.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  v.id === variantId
                    ? "bg-surface text-neutral-900 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-900"
                }`}
              >
                {finishLabel(v.finish)}
                {v.value !== null ? (
                  <span className="ml-1 text-neutral-400">{formatEur(v.value)}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-sm text-neutral-600">
            {finishLabel(variant?.finish ?? "")}
            {variant?.value !== null && variant?.value !== undefined
              ? ` · ${formatEur(variant.value)}`
              : ""}
          </span>
        )}
        <Button type="submit" disabled={pending || !variantId} className="ml-auto">
          <Plus className="h-4 w-4" /> {pending ? "Adding…" : "Add to collection"}
        </Button>
      </div>

      <button
        type="button"
        onClick={() => setMore((m) => !m)}
        aria-expanded={more}
        className="mt-3 flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${more ? "rotate-180" : ""}`} />
        More options (quantity, condition, grading, price paid)
      </button>

      {more ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="label">
            Quantity
            <input
              className="field"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <label className="label">
            Condition
            <select
              className="field"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              disabled={Boolean(grading)}
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABEL[c] ?? c}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Grading company
            <select className="field" value={grading} onChange={(e) => setGrading(e.target.value)}>
              <option value="">Ungraded</option>
              {GRADING_COMPANIES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Grade
            <input
              className="field"
              type="number"
              step={0.5}
              min={1}
              max={10}
              value={grade}
              disabled={!grading}
              onChange={(e) => setGrade(e.target.value)}
            />
          </label>
          <label className="label">
            Price paid per card (€)
            <input
              className="field"
              type="number"
              min={0}
              step={0.01}
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              placeholder="optional"
            />
          </label>
          <label className="label">
            Notes
            <input
              className="field"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="optional"
            />
          </label>
        </div>
      ) : null}
    </form>
  );
}
