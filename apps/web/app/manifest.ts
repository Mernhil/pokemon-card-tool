import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TCG Vault",
    short_name: "TCG Vault",
    description: "Collection tracker, 3D card viewer and portfolio dashboard for TCG cards.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0c0a09",
    theme_color: "#0c0a09",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
