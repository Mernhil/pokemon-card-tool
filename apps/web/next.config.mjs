/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@tcg-vault/db", "@tcg-vault/shared", "@tcg-vault/pricing", "@tcg-vault/sources"],
  // Self-contained server (bundles node_modules) — what the Tauri sidecar runs.
  output: "standalone",
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
