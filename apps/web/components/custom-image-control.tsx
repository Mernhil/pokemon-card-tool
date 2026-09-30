"use client";

import { ImagePlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  removeCustomImageAction,
  setCustomImageAction,
} from "../app/[game]/[set]/[number]/actions";
import { useToast } from "./ui/toast";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * "Set custom image": pick a file or drop one on the button. The server
 * re-checks type (by content) and size; this only saves a round trip.
 * With `hasCustom` it shows a "Custom image" badge and a Remove option.
 */
export function CustomImageControl({
  printingId,
  hasCustom = false,
  compact = false,
}: {
  printingId: string;
  hasCustom?: boolean;
  /** Small variant for missing-image tiles inside a link. */
  compact?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!TYPES.includes(file.type)) return void toast("error", "Choose a PNG, JPEG or WebP image.");
    if (file.size > MAX_BYTES) return void toast("error", "That image is over the 10 MB limit.");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("printingId", printingId);
      form.set("file", file);
      const result = await setCustomImageAction(form);
      if (result.ok) {
        toast("success", "Custom image saved");
        router.refresh();
      } else toast("error", result.error ?? "Couldn't save that image.");
    } catch {
      toast("error", "Couldn't save that image.");
    } finally {
      setBusy(false);
    }
  };

  // Inside a card tile (a link): never follow the link when using the control.
  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "justify-center" : ""}`}>
      {hasCustom ? (
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-800">
          Custom image
        </span>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          stop(e);
          input.current?.click();
        }}
        onDragOver={(e) => {
          stop(e);
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          stop(e);
          setOver(false);
          void upload(e.dataTransfer.files[0]);
        }}
        className={`inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-[11px] font-medium hover:bg-surface-2 disabled:opacity-50 ${
          over ? "border-accent bg-accent-soft" : "border-neutral-300"
        }`}
        title="Choose an image file, or drop one here"
      >
        <ImagePlus className="h-3 w-3" />
        {busy ? "Saving…" : hasCustom ? "Replace image" : "Set custom image"}
      </button>
      {hasCustom ? (
        <button
          type="button"
          disabled={busy}
          onClick={async (e) => {
            stop(e);
            setBusy(true);
            try {
              await removeCustomImageAction(printingId);
              toast("success", "Custom image removed");
              router.refresh();
            } finally {
              setBusy(false);
            }
          }}
          className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-900"
        >
          <X className="h-3 w-3" /> Remove
        </button>
      ) : null}
      <input
        ref={input}
        type="file"
        accept={TYPES.join(",")}
        hidden
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
