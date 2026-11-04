import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");

/** @type {import('next').NextConfig} */
// `CF_BUILD=1` (see the cf:* scripts): build for Cloudflare Workers. Prisma 7
// generates one client per runtime, and the database client differs (D1).
const cloudflare = process.env.CF_BUILD === "1";

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
  webpack(config, { webpack }) {
    if (cloudflare) {
      // The Node and Workers clients share one source tree. Swap the Node database client
      // and generated Prisma client for the Workers ones as modules get resolved.
      const db = resolve(here, "../../packages/db/src").replaceAll("\\", "/");
      const shared = resolve(here, "../../packages/shared/src").replaceAll("\\", "/");
      const swaps = new Map([
        [`${db}/client.ts`, `${db}/client.workers.ts`],
        [`${db}/generated/node/client.ts`, `${db}/generated/workerd/client.ts`],
        [`${shared}/local-storage.ts`, `${shared}/local-storage.workers.ts`],
      ]);
      config.plugins.push({
        apply(compiler) {
          compiler.hooks.normalModuleFactory.tap("tcg-vault-workers", (factory) => {
            factory.hooks.afterResolve.tap("tcg-vault-workers", (data) => {
              const swapped = swaps.get(data.createData.resource.replaceAll("\\", "/"));
              if (swapped) {
                data.createData.resource = resolve(swapped);
                data.createData.request = resolve(swapped);
              }
            });
          });
        },
      });
      // The Prisma query compiler is a .wasm module that workerd imports natively;
      // leave it for the Workers bundler instead of having webpack parse it.
      // OpenNext resolves the import relative to every importing route file, so point it at the one real file.
      const wasm = `${db}/generated/workerd/internal/query_compiler_fast_bg.wasm`;
      const external = ({ request }, callback) =>
        /\.wasm(\?module)?$/.test(request ?? "") ? callback(null, `module ${wasm}?module`) : callback();
      config.externals = [...(config.externals ?? []), external];
    }
    return config;
  },
  // Inlined at build time: the hosted build has no in-process scheduler (cron triggers instead).
  env: { TCG_VAULT_CLOUD: cloudflare ? "1" : "" },
  experimental: {
    // "Set custom image" uploads a card scan (up to 10 MB) through a server action.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
