import type { Metadata } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/inter";
import "@fontsource-variable/cinzel";
import "./globals.css";
import { Providers } from "./providers";
import { Sidebar } from "../components/sidebar";
import { SIDEBAR_COOKIE } from "../lib/ui-cookies";
import { ToastProvider } from "../components/ui/toast";
import { UpdateBanner } from "../components/update-banner";
import { HistoryNavigation } from "../components/history-navigation";
import { ExternalLinks } from "../components/external-links";
import { LastSearchRecorder } from "../components/last-search";
import { MoneyConfig } from "../components/money-config";
import { loadMoneyDisplay } from "../lib/money-config";
import { THEME_COOKIE, parseTheme } from "../lib/theme";

export const metadata: Metadata = {
  title: "TCG Vault",
  description: "Collection tracker, 3D card viewer and portfolio dashboard for TCG cards.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendered server-side from cookies, so there's no flash of the wrong theme/layout.
  const jar = cookies();
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  const collapsed = jar.get(SIDEBAR_COOKIE)?.value === "collapsed";
  const money = await loadMoneyDisplay();
  return (
    <html lang="en" className={theme === "system" ? undefined : theme}>
      <body>
        <MoneyConfig display={money} />
        <HistoryNavigation />
        <ExternalLinks />
        <LastSearchRecorder />
        <Providers>
          <ToastProvider>
            <div className="flex min-h-screen">
              <Sidebar initialCollapsed={collapsed} theme={theme} />
              <div className="min-w-0 flex-1">{children}</div>
            </div>
            <UpdateBanner />
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
