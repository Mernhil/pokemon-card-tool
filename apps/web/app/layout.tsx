import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";
import { NavBar } from "../components/nav-bar";
import { THEME_COOKIE, parseTheme } from "../lib/theme";

export const metadata: Metadata = {
  title: "TCG Vault",
  description: "Collection tracker, 3D card viewer and portfolio dashboard for TCG cards.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendered server-side from the cookie, so there's no light flash before dark kicks in.
  const theme = parseTheme(cookies().get(THEME_COOKIE)?.value);
  return (
    <html lang="en" className={theme === "system" ? undefined : theme}>
      <body>
        <Providers>
          <NavBar theme={theme} />
          {children}
        </Providers>
      </body>
    </html>
  );
}
