import { revalidatePath } from "next/cache";
import { runSync, type SyncEvent } from "../../../lib/sync-runner";

export const dynamic = "force-dynamic";

/**
 * POST { codes: string[] } syncs those sets; { refresh: true } re-syncs every
 * synced set (fresh prices). Streams newline-delimited JSON SyncEvents so the
 * Sync page can show live progress.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { codes?: unknown; refresh?: unknown };
  const codes = body.refresh
    ? null
    : Array.isArray(body.codes)
      ? [
          ...new Set(
            body.codes
              .map(String)
              .map((c) => c.trim())
              .filter(Boolean),
          ),
        ]
      : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const emit = (event: SyncEvent) => {
        if (!open) return; // client went away; keep syncing, stop writing
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      await runSync(codes, emit);
      revalidatePath("/", "layout");
      if (open) controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
