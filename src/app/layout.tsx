import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ai-website-improvement-agent.vercel.app"),
  title: "AI Webサイト改善エージェント",
  description:
    "GoalからCrawl、決定論的監査、AI解釈、再調査、改善Backlog、Human Reviewまで自律的に進めるWeb改善エージェント。",
  applicationName: "AI Webサイト改善エージェント",
  keywords: ["AIエージェント", "Web監査", "SEO", "UX", "Accessibility", "Technical Audit"],
  openGraph: {
    title: "AI Webサイト改善エージェント",
    description: "根拠を残し、再調査し、人が判断できるWeb改善Agent。",
    type: "website",
    locale: "ja_JP",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#11151d" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
