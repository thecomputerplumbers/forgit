import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { ThemeEffects } from "@/components/theme";
import { MODE_COOKIE, MODE_SCRIPT, THEME_COOKIE, modePreference, themeById } from "@/lib/themes";

import "./globals.css";
import "./themes.css";

export const metadata: Metadata = {
  title: { default: "forgit", template: "%s · forgit" },
  description: "Self-hostable Git on Cloudflare",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%2314324d'/%3E%3Cpath d='M11 8v12M21 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM11 26a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 14a9 9 0 0 1-9 9' fill='none' stroke='%23f0c56a' stroke-width='2.4' stroke-linecap='round'/%3E%3C/svg%3E",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#14171c" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const theme = themeById(jar.get(THEME_COOKIE)?.value);
  const mode = modePreference(jar.get(MODE_COOKIE)?.value);
  return (
    // data-mode is resolved in the browser by MODE_SCRIPT when the preference is "system".
    <html
      data-mode={mode === "system" ? "light" : mode}
      data-mode-pref={mode}
      data-theme={theme.id}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@125,800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        {theme.fonts ? (
          <link href={theme.fonts} id={`theme-font-${theme.id}`} rel="stylesheet" />
        ) : null}
      </head>
      <body>
        {children}
        <ThemeEffects />
      </body>
    </html>
  );
}
