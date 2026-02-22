import type { Metadata } from "next";
import { Inter, Noto_Serif_SC } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { getSettings } from "@/lib/typecho-client";

import "@excalidraw/excalidraw/index.css";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["300", "400", "500", "700", "900"],
});

const notoSerifSc = Noto_Serif_SC({
  subsets: ["latin"],
  variable: "--font-noto-serif-sc",
  display: "swap",
  weight: ["400", "500", "700", "900"],
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${inter.variable} ${notoSerifSc.variable} min-h-screen bg-bg text-primary antialiased`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
