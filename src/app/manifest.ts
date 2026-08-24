import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI Webサイト改善エージェント",
    short_name: "Web改善Agent",
    description: "CrawlからHuman Reviewまで進めるWeb改善Agent",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7fb",
    theme_color: "#2d64f3",
    lang: "ja",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
