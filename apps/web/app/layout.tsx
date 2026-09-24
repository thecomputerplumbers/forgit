import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { ThemeEffects } from "@/components/theme";
import { MODE_COOKIE, MODE_SCRIPT, THEME_COOKIE, modePreference, themeById } from "@/lib/themes";

import "./globals.css";
import "./themes.css";

export async function generateMetadata(): Promise<Metadata> {
  const { env } = await import("cloudflare:workers");
  const base = new URL(env.APP_URL);
  const description =
    env.HOSTED_MODE === "true"
      ? "Git, Actions, and verified repair proposals on Cloudflare."
      : "Self-hosted Git on Cloudflare. Commit less. Live more.";
  return {
    metadataBase: base,
    title: { default: "forgit", template: "%s · forgit" },
    description,
    applicationName: "forgit",
    icons: {
      icon: [
        { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      shortcut: "/brand/favicon.ico",
      apple: "/brand/apple-touch-icon.png",
    },
    openGraph: {
      type: "website",
      siteName: "forgit",
      title: "forgit",
      description,
      url: base.origin,
      images: [
        { url: "/brand/og.png", width: 1200, height: 630, alt: "forgit: commit less, live more" },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "forgit",
      description,
      images: ["/brand/og.png"],
    },
  };
}

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
