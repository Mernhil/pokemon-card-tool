/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@tcg-vault/db", "@tcg-vault/shared"],
};

export default nextConfig;
