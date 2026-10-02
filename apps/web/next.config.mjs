/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@tcg-vault/card-fx",
    "@tcg-vault/db",
    "@tcg-vault/shared",
    "@tcg-vault/pricing",
    "@tcg-vault/sources",
  ],
  // Self-contained server (bundles node_modules) — what the Tauri sidecar runs.
  output: "standalone",
  // libsql loads a per-platform native module by a computed name, which the
  // standalone tracer can’t see: keep it external and trace it in by hand.
  serverExternalPackages: ["@libsql/client", "libsql"],
  outputFileTracingIncludes: {
    "/**": ["../../node_modules/@libsql/**/*", "../../node_modules/libsql/**/*"],
  },
  experimental: {
    // "Set custom image" uploads a card scan (up to 10 MB) through a server action.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
