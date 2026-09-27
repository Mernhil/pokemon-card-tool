"use client";

import { BINDER_COLORS, BINDER_LAYOUTS } from "@tcg-vault/db/src/binder-options";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createBinderAction } from "../../app/binders/actions";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { useToast } from "../ui/toast";

export function NewBinderButton({
  sets,
  variant = "primary",
}: {
  sets: Array<{ id: number; name: string; printings: number }>;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(BINDER_COLORS[0]);
  const [layout, setLayout] = useState(1); // 3x3
  const [pages, setPages] = useState(10);
  const [setId, setSetId] = useState<number | null>(null);
  const router = useRouter();
  const toast = useToast();
  const chosenSet = sets.find((s) => s.id === setId);
  const { rows, cols } = BINDER_LAYOUTS[layout]!;
  const setPages_ = chosenSet ? Math.max(1, Math.ceil(chosenSet.printings / (rows * cols))) : null;

  const submit = () =>
    start(async () => {
      const res = await createBinderAction({
        name: name || chosenSet?.name || "",
        color,
        rows,
        cols,
        pages,
        setId,
      });
      if (!res.ok) {
        toast("error", res.error);
        return;
      }
      setOpen(false);
      toast("success", `Created “${name || chosenSet?.name || "My binder"}”`);
      router.push(`/binders/${res.data}`);
    });

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New binder
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New binder">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="label">
            Start from a set (optional)
            <select
              className="field"
              value={setId ?? ""}
              onChange={(e) => setSetId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Empty binder</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.printings} cards
                </option>
              ))}
            </select>
            {chosenSet ? (
              <span className="text-[11px] font-normal text-neutral-500">
                One pocket per card in set order. Cards you own go in; the rest become greyed-out
                “wanted” pockets.
              </span>
            ) : null}
          </label>
          <label className="label">
            Name
            <input
              className="field"
              value={name}
              placeholder={chosenSet?.name ?? "My binder"}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </label>
          <div className="label">
            Cover
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cover colour">
              {BINDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 shadow-inner transition-transform hover:scale-110 ${
                    color === c ? "border-accent ring-2 ring-accent/40" : "border-transparent"
                  }`}
                  style={{ background: `radial-gradient(circle at 35% 30%, ${c}cc, ${c})` }}
                />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="label">
              Pockets per page
              <select
                className="field"
                value={layout}
                onChange={(e) => setLayout(Number(e.target.value))}
              >
                {BINDER_LAYOUTS.map((l, i) => (
                  <option key={l.label} value={i}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Pages
              <input
                className="field"
                type="number"
                min={1}
                max={200}
                value={setPages_ ?? pages}
                disabled={setPages_ !== null}
                onChange={(e) => setPages(Number(e.target.value) || 1)}
              />
            </label>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create binder"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
