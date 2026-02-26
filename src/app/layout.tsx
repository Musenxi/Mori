import type { Metadata } from "next";
import { Inter, Special_Elite } from "next/font/google";
import { Suspense } from "react";

import { MotionProvider } from "@/components/motion-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Shell } from "@/components/shell";
import { ViewTransitionProvider } from "@/components/view-transition-provider";
import { getSettings } from "@/lib/typecho-client";
import { getSiteContext } from "@/lib/site-data";
import { buildNavItems } from "@/lib/navigation";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["300", "400", "500", "700", "900"],
});

const specialElite = Special_Elite({
  subsets: ["latin"],
  variable: "--font-special-elite",
  display: "swap",
  weight: "400",
  preload: false,
});

function normalizeMetaText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const title = normalizeMetaText(settings.title);
  const description = normalizeMetaText(settings.description);

  return {
    title: {
      default: title,
      template: `%s | ${title}`,
    },
    description,
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const context = await getSiteContext();
  const navItems = buildNavItems(context);

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${specialElite.variable} min-h-screen bg-bg text-primary antialiased`}
      >
        <MotionProvider>
          <ThemeProvider>
            <Suspense fallback={null}>
              <ViewTransitionProvider />
            </Suspense>
            <Shell context={context} navItems={navItems}>
              {children}
            </Shell>
          </ThemeProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
