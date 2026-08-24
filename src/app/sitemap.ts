import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://ai-website-improvement-agent.vercel.app",
      lastModified: new Date("2026-08-25T00:00:00.000Z"),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
