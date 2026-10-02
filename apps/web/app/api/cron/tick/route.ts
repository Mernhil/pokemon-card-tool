import { runCloudTick } from "../../../../lib/cloud-tick";

export const dynamic = "force-dynamic";

/**
 * Called by the Worker's cron trigger (worker.ts), never by the app. The
 * Cloudflare Access policy in front of the site can't tell it from a visitor,
 * so it carries a shared secret (CRON_SECRET, set with `wrangler secret put`).
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("x-cron-secret") !== secret) {
    return new Response("Forbidden", { status: 403 });
  }
  const log = await runCloudTick();
  return Response.json({ ok: true, log });
}
