import { describe, expect, it } from "vitest";
import { buildImageUrl } from "./imgproxy";

describe("buildImageUrl", () => {
  const env = {
    IMGPROXY_URL: "http://localhost:8080",
    IMGPROXY_KEY: "aabbccdd",
    IMGPROXY_SALT: "11223344",
    STORAGE_BUCKET: "tcg-vault-media",
  };

  for (const [k, v] of Object.entries(env)) process.env[k] = v;

  it("builds a URL shaped like <base>/<signature>/rs:fit:<w>:<w>:0/<encoded-source>", () => {
    const url = buildImageUrl("printings/abc123.jpg", "thumb");
    expect(url).toMatch(/^http:\/\/localhost:8080\/[\w-]+\/rs:fit:245:245:0\/[\w-]+$/);
  });

  it("is deterministic for the same inputs", () => {
    const a = buildImageUrl("printings/abc123.jpg", "grid");
    const b = buildImageUrl("printings/abc123.jpg", "grid");
    expect(a).toBe(b);
  });

  it("changes the signature when the key changes", () => {
    const a = buildImageUrl("printings/abc123.jpg", "full");
    process.env.IMGPROXY_KEY = "deadbeef";
    const b = buildImageUrl("printings/abc123.jpg", "full");
    expect(a).not.toBe(b);
  });
});
