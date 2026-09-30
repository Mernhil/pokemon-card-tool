"use client";

import type { ImportMatch } from "@tcg-vault/db";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { setCustomImageAction } from "../[game]/[set]/[number]/actions";
import { Button } from "../../components/ui/button";
import { useToast } from "../../components/ui/toast";
import { previewImageImportAction } from "./actions";

export function ImportImagesForm({ sets }: { sets: Array<{ id: number; label: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const [setId, setSetId] = useState<number | "">("");
  const [files, setFiles] = useState<File[]>([]);
  const [matches, setMatches] = useState<ImportMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const folder = useRef<HTMLInputElement>(null);

  const preview = async (nextSet: number | "", nextFiles: File[]) => {
    if (nextSet === "" || nextFiles.length === 0) return setMatches(null);
    setMatches(
      await previewImageImportAction(
        nextSet,
        nextFiles.map((f) => f.name),
      ),
    );
  };

  const ok = matches?.filter((m) => m.printingId) ?? [];

  const save = async () => {
    setBusy(true);
    let saved = 0;
    const failed: string[] = [];
    for (const m of ok) {
      const file = files.find((f) => f.name === m.fileName);
      if (!file || !m.printingId) continue;
      const form = new FormData();
      form.set("printingId", m.printingId);
      form.set("file", file);
      const r = await setCustomImageAction(form).catch(() => ({ ok: false, error: "failed" }));
      if (r.ok) saved++;
      else failed.push(`${m.fileName}: ${r.error ?? "failed"}`);
    }
    setBusy(false);
    toast(
      failed.length ? "error" : "success",
      `Saved ${saved} image${saved === 1 ? "" : "s"}${failed.length ? `; ${failed.length} failed (${failed[0]})` : ""}`,
    );
    setMatches(null);
    setFiles([]);
    router.refresh();
  };

  return (
    <div className="panel flex flex-col gap-4 p-5">
      <label className="flex flex-col gap-1 text-sm">
        Set
        <select
          className="field"
          value={setId}
          onChange={(e) => {
            const v = e.target.value ? Number(e.target.value) : "";
            setSetId(v);
            void preview(v, files);
          }}
        >
          <option value="">Choose a set…</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div>
        <input
          ref={folder}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          // Folder picker (Chromium / WebView2); plain multi-select still works elsewhere.
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])].filter((f) =>
              /\.(png|jpe?g|webp)$/i.test(f.name),
            );
            setFiles(picked);
            void preview(setId, picked);
          }}
        />
      </div>

      {matches ? (
        <>
          <p className="text-sm">
            {ok.length} of {matches.length} file{matches.length === 1 ? "" : "s"} match a card.
          </p>
          <ul className="max-h-80 overflow-auto rounded-lg bg-surface-2 p-3 text-xs">
            {matches.map((m) => (
              <li key={m.fileName} className="py-0.5">
                <span className="font-mono">{m.fileName}</span> →{" "}
                {m.printingId ? (
                  <span>
                    {m.cardName} <span className="text-neutral-500">{m.collectorNumber}</span>
                  </span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-300">{m.problem}</span>
                )}
              </li>
            ))}
          </ul>
          <div>
            <Button disabled={busy || ok.length === 0} onClick={save}>
              {busy ? "Saving…" : `Save ${ok.length} image${ok.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
