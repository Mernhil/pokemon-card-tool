import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { NavBar } from "../components/nav-bar";

export const metadata: Metadata = {
  title: "TCG Vault",
  description: "Collection tracker, 3D card viewer and portfolio dashboard for TCG cards.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <NavBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
