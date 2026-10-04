"use client";

import type { ScanCandidate } from "@tcg-vault/db";
import { Camera, CameraOff, ScanLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { adjustCopiesAction } from "../actions";
import { CardImage } from "../../components/card-image";
import { finishLabel } from "../../components/money";
import { Button } from "../../components/ui/button";
import { useToast } from "../../components/ui/toast";
import { lookupScanAction, type ScanLookup } from "./actions";

type Worker = import("tesseract.js").Worker;

/** Only what a collector number is made of, so OCR doesn't wander into card text. */
const WHITELIST = "0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function ScanClient() {
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const busyRef = useRef(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [status, setStatus] = useState("");
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<ScanLookup | null>(null);
  const [added, setAdded] = useState<Array<{ key: number; text: string }>>([]);
  const keyRef = useRef(0);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    setAuto(false);
  }, []);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void workerRef.current?.terminate();
    },
    [],
  );

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      // The <video> mounts once cameraOn is set; attach on the next frame.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch (err) {
      setCameraError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera access was refused. Allow it in Windows privacy settings (Camera) and try again."
          : "No usable camera found.",
      );
    }
  };

  const worker = async (): Promise<Worker> => {
    if (workerRef.current) return workerRef.current;
    setStatus("Loading the text reader (first use needs an internet connection)…");
    const { createWorker } = await import("tesseract.js");
    const w = await createWorker("eng");
    await w.setParameters({ tessedit_char_whitelist: WHITELIST });
    workerRef.current = w;
    return w;
  };

  /** The bottom strip of the frame, enlarged and in high-contrast greys, where the number is printed. */
  const grabStrip = (): HTMLCanvasElement | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;
    const stripH = Math.round(video.videoHeight * 0.3);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth * 1.5;
    canvas.height = stripH * 1.5;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.filter = "grayscale(1) contrast(1.7)";
    ctx.drawImage(video, 0, video.videoHeight - stripH, video.videoWidth, stripH, 0, 0, canvas.width, canvas.height);
    return canvas;
  };

  const lookup = useCallback(async (text: string) => {
    const found = await lookupScanAction(text);
    setResult(found);
    return found;
  }, []);

  const scan = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const strip = grabStrip();
      if (!strip) {
        setStatus("The camera isn't ready yet.");
        return;
      }
      const w = await worker();
      setStatus("Reading…");
      const { data } = await w.recognize(strip);
      const found = await lookup(data.text);
      setStatus(
        found.numbers.length === 0
          ? "No collector number read. Move the card so its bottom edge fills the frame."
          : found.candidates.length === 0
            ? `Read ${found.numbers.map((n) => (n.total ? `${n.number}/${n.total}` : n.number)).join(", ")}, but no card in the catalog has it.`
            : `Read ${found.numbers.map((n) => (n.total ? `${n.number}/${n.total}` : n.number)).join(", ")}.`,
      );
      if (found.candidates.length > 0) setAuto(false);
    } catch (err) {
      setStatus(`Scanning failed: ${err instanceof Error ? err.message : String(err)}`);
      setAuto(false);
    } finally {
      busyRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup]);

  useEffect(() => {
    if (!auto || !cameraOn) return;
    const id = setInterval(() => void scan(), 1800);
    return () => clearInterval(id);
  }, [auto, cameraOn, scan]);

  const add = async (c: ScanCandidate, variantId: string, finish: string) => {
    const r = await adjustCopiesAction(variantId, 1);
    if (!r.ok) return toast("error", r.error);
    setAdded((a) => [{ key: ++keyRef.current, text: `${c.name} ${c.number} · ${c.setName} · ${finishLabel(finish)}` }, ...a].slice(0, 20));
    toast("success", `Added ${c.name}`);
    setResult(null);
    setStatus("Added. Show the next card.");
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="panel p-4">
        {cameraOn ? (
          <div className="flex flex-col gap-3">
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video ref={videoRef} playsInline muted className="max-h-[60vh] w-full object-contain" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[30%] border-t-2 border-dashed border-accent/80 bg-accent/10" />
            </div>
            <p className="text-xs text-neutral-500">
              The shaded strip is what gets read. Keep the number inside it, in focus and lit evenly.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void scan()}>
                <ScanLine className="h-4 w-4" /> Scan
              </Button>
              <label className="flex items-center gap-1.5 text-sm text-neutral-600">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                Keep scanning until a card is found
              </label>
              <Button variant="secondary" onClick={stopCamera}>
                <CameraOff className="h-4 w-4" /> Stop camera
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <Button onClick={() => void startCamera()}>
              <Camera className="h-4 w-4" /> Start camera
            </Button>
            {cameraError ? (
              <p role="alert" className="text-sm text-red-600">
                {cameraError}
              </p>
            ) : null}
          </div>
        )}
        {status ? (
          <p className="mt-3 text-sm text-neutral-600" aria-live="polite">
            {status}
          </p>
        ) : null}
      </section>

      <section className="panel p-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!typed.trim()) return;
            const found = await lookup(typed);
            setStatus(found.candidates.length ? "" : "No card found for that number.");
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Or type the number
            <input
              className="field w-48 py-1.5 text-sm"
              value={typed}
              placeholder="025/198"
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
          <Button type="submit" variant="secondary">
            Find
          </Button>
        </form>
      </section>

      {result && result.candidates.length > 0 ? (
        <section aria-label="Matches" className="grid gap-3 sm:grid-cols-2">
          {result.candidates.map((c) => (
            <div key={c.printingId} className="panel flex gap-3 p-3">
              <div className="w-20 shrink-0">
                <CardImage imageKey={c.imageKey} name={c.name} number={c.number} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-neutral-500">
                  {c.setName} · {c.number}
                  {c.score < 1 ? " · set not confirmed" : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.variants.map((v) => (
                    <Button
                      key={v.id}
                      size="sm"
                      variant="secondary"
                      onClick={() => void add(c, v.id, v.finish)}
                    >
                      + {finishLabel(v.finish)}
                      {v.languageCode === "en" ? "" : ` (${v.languageCode})`}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {added.length > 0 ? (
        <section className="panel p-4">
          <h2 className="text-sm font-semibold">Added this session</h2>
          <ul className="mt-2 flex flex-col gap-0.5 text-sm text-neutral-600">
            {added.map((a) => (
              <li key={a.key}>{a.text}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
