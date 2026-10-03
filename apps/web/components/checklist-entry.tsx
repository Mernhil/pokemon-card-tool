"use client";

import {
  CONDITIONS,
  matchChecklistCard,
  parseChecklistEntry,
  pickChecklistFinish,
} from "@tcg-vault/shared";
import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { addCopiesAction, removeCopiesAction } from "../app/actions";
import { finishLabel } from "./money";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";
import type { SetGridCard } from "./set-grid";

const DEFAULT_CONDITION = "NEAR_MINT";
const conditionLabel = (c: string) => c.replaceAll("_", " ").toLowerCase();

interface LogEntry {
  key: number;
  name: string;
  number: string;
  quantity: number;
  finish: string;
  condition: string;
  variantId: string;
  /** Row to take the copies back out of, for entries made in a non-default condition. */
  itemId: string | null;
}

/**
 * Keyboard entry for a whole binder: type a collector number and press Enter.
 * "25x3" adds three. ↑/↓ switch the finish, PageUp/PageDown the condition,
 * Esc undoes the last entry. Near mint goes through the same optimistic
 * quick-add queue as the tiles; other conditions are saved directly.
 */
export function ChecklistEntry({
  cards,
  adjust,
  onClose,
}: {
  cards: SetGridCard[];
  adjust: (variantId: string, delta: 1 | -1) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);
  const [text, setText] = useState("");
  const [finish, setFinish] = useState("NON_FOIL");
  const [condition, setCondition] = useState(DEFAULT_CONDITION);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => inputRef.current?.focus(), []);

  // The finishes this set has, ordinary prints first, for the up/down keys.
  const finishes = [...new Set(cards.flatMap((c) => c.variants.map((v) => v.finish)))].sort(
    (a, b) => Number(a.includes(":")) - Number(b.includes(":")),
  );
  const cycle = <T,>(list: T[], current: T, step: number) =>
    list[(list.indexOf(current) + step + list.length) % list.length] ?? current;

  const submit = async () => {
    const entry = parseChecklistEntry(text);
    if (!entry) return;
    const card = matchChecklistCard(cards, entry.number);
    if (!card) {
      setProblem(`No single card numbered "${entry.number}" in this set`);
      return;
    }
    const kind = pickChecklistFinish(card.variants.map((v) => v.finish), finish);
    const variant = card.variants.find((v) => v.finish === kind);
    if (!variant || !kind) {
      setProblem(`${card.name} has no variant to add`);
      return;
    }
    setProblem(null);
    setText("");
    const base = {
      key: ++keyRef.current,
      name: card.name,
      number: card.number,
      quantity: entry.quantity,
      finish: kind,
      condition,
      variantId: variant.id,
    };
    if (condition === DEFAULT_CONDITION) {
      for (let i = 0; i < entry.quantity; i++) adjust(variant.id, 1);
      setLog((l) => [{ ...base, itemId: null }, ...l].slice(0, 30));
    } else {
      const result = await addCopiesAction(variant.id, entry.quantity, condition);
      if (!result.ok) {
        setProblem(result.error);
        return;
      }
      setLog((l) => [{ ...base, itemId: result.itemId }, ...l].slice(0, 30));
      router.refresh();
    }
  };

  const undo = async () => {
    const last = log[0];
    if (!last) return;
    setLog((l) => l.slice(1));
    if (last.itemId) {
      const result = await removeCopiesAction(last.itemId, last.quantity);
      if (!result.ok) toast("error", result.error);
      else router.refresh();
    } else {
      for (let i = 0; i < last.quantity; i++) adjust(last.variantId, -1);
    }
  };

  return (
    <div className="panel mb-5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-neutral-500">
          Card number, then Enter
          <input
            ref={inputRef}
            className="field py-2 text-base"
            value={text}
            placeholder="25   or   25x3   or   TG01"
            autoComplete="off"
            aria-label="Card number"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                setFinish((f) => cycle(finishes, f, e.key === "ArrowUp" ? -1 : 1));
              } else if (e.key === "PageUp" || e.key === "PageDown") {
                e.preventDefault();
                setCondition((c) => cycle([...CONDITIONS], c, e.key === "PageUp" ? -1 : 1));
              } else if (e.key === "Escape") {
                e.preventDefault();
                if (text) setText("");
                else void undo();
              }
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Finish (↑ ↓)
          <select
            className="field py-2"
            value={finish}
            onChange={(e) => setFinish(e.target.value)}
          >
            {finishes.map((f) => (
              <option key={f} value={f}>
                {finishLabel(f)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Condition (PgUp PgDn)
          <select
            className="field py-2"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {conditionLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2 self-end">
          <Button size="sm" variant="secondary" onClick={() => void undo()} disabled={log.length === 0}>
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
      {problem ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {problem}
        </p>
      ) : null}
      {log.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-0.5 text-sm" aria-label="Added so far">
          {log.map((e) => (
            <li key={e.key} className="text-neutral-600">
              <span className="tabular-nums text-neutral-400">{e.number}</span> {e.name}{" "}
              <span className="text-neutral-400">
                ×{e.quantity} · {finishLabel(e.finish)} · {conditionLabel(e.condition)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
