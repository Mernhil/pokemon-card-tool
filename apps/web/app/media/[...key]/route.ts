import { NextResponse } from "next/server";
import { getCardImageResult, getSettingsCached, type ImageResult } from "@tcg-vault/db";
import { REMOTE_IMAGE_PREFIX, getFile } from "@tcg-vault/shared";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

/** Card-shaped stand-in when a scan can't be fetched right now. Never cached. */
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5f5f4"/><stop offset="1" stop-color="#d6d3d1"/></linearGradient></defs>
<rect x="8" y="8" width="484" height="684" rx="24" fill="url(#g)" stroke="#fcd34d" stroke-width="16"/>
<text x="250" y="340" font-family="system-ui,sans-serif" font-size="28" fill="#57534e" text-anchor="middle">Image unavailable</text>
<text x="250" y="380" font-family="system-ui,sans-serif" font-size="20" fill="#a8a29e" text-anchor="middle">Tried again next time you open it</text>
</svg>`;

function placeholder(strict = false) {
  // Strict callers (the card tiles) want a real 404 so their <img> reports the error.
  return new NextResponse(PLACEHOLDER_SVG, {
    status: strict ? 404 : 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
      "X-Image-Status": "unavailable",
    },
  });
}

const EMPTY: ImageResult = {
  image: null,
  status: "failed",
  attempts: [],
  reason: "Not tried yet.",
};

/**
 * Local media: set logos, user photos, scans from older syncs — and card
 * scans behind `remote/<printingId>` keys, which go through the lazy image
 * cache (packages/db/src/image-cache.ts): served from disk, or fetched once
 * and cached. A scan that can't be fetched gets a placeholder, not an error.
 */
export async function GET(req: Request, { params }: { params: { key: string[] } }) {
  const key = params.key.join("/");
  const query = new URL(req.url).searchParams;
  const strict = query.get("strict") === "1";

  if (key.startsWith(REMOTE_IMAGE_PREFIX)) {
    const printingId = key.slice(REMOTE_IMAGE_PREFIX.length);
    if (!printingId || printingId.includes("/")) return placeholder(strict);
    const result = await getSettingsCached()
      .then((settings) =>
        getCardImageResult(printingId, { maxBytes: settings.imageCacheMaxMb * 1024 * 1024 }),
      )
      .catch(() => EMPTY);
    // ?why=1: what was tried and why it failed, for the tile's tooltip (no network involved).
    if (query.get("why") === "1") {
      return NextResponse.json(
        { status: result.status, reason: result.reason },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const image = result.image;
    if (!image) return placeholder(strict);
    return new NextResponse(new Uint8Array(image.body), {
      headers: {
        "Content-Type": image.contentType,
        // Not "immutable": the cache may evict it, and a re-sync may point
        // the printing at a better scan.
        "Cache-Control": "public, max-age=604800",
        "X-Image-Status": image.from,
      },
    });
  }

  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  try {
    const file = await getFile(key);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
