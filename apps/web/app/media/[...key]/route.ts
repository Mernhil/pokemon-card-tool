import { NextResponse } from "next/server";
import { getFile } from "@tcg-vault/shared";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

export async function GET(_req: Request, { params }: { params: { key: string[] } }) {
  const key = params.key.join("/");
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
