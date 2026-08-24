import { describe, expect, it } from "vitest";

import { clampCrawlLimits, crawlSite, normalizeCrawlUrl, type AuditCheck } from "./client-crawl";
import type { SiteAuditResult } from "./site-audit/types";

function page(url: string, links: string[] = []): SiteAuditResult {
  return {
    id: url,
    inputUrl: url,
    finalUrl: url,
    statusCode: 200,
    statusKind: "ok",
    broken: false,
    redirectCount: 0,
    redirectChain: [],
    redirectLoop: false,
    redirectLimit: false,
    responseTimeMs: 42,
    contentType: "text/html",
    metadata: { title: url, description: "description", canonical: url, h1: "Heading", h1Count: 1 },
    accessibility: {
      imagesChecked: 0,
      missingAltCount: 0,
      controlsChecked: 0,
      unlabeledControlCount: 0,
      headingJumps: [],
      contrast: { status: "manual_review", reason: "render needed" },
    },
    contentSnippet: "content",
    contentSnippetTruncated: false,
    technologyHints: [],
    internalLinks: links.map((link) => ({ url: link, text: link, scope: "internal" as const })),
    externalLinks: [],
    issues: [],
    bodyReadable: true,
    bodyTruncated: false,
    checkedAt: "2026-08-25T00:00:00.000Z",
  };
}

describe("client crawl", () => {
  it("normalizes fragments and clamps every guardrail", () => {
    expect(normalizeCrawlUrl("https://example.com/a#section")).toBe("https://example.com/a");
    expect(normalizeCrawlUrl("file:///etc/passwd")).toBeNull();
    expect(clampCrawlLimits({ maxPages: 9_999, maxDepth: -2, concurrency: 90, timeoutMs: 1 }))
      .toMatchObject({ maxPages: 50, maxDepth: 0, concurrency: 4, timeoutMs: 2_000 });
  });

  it("uses stable BFS order, deduplicates cycles, and obeys depth", async () => {
    const graph: Record<string, string[]> = {
      "https://example.com/": ["https://example.com/a", "https://example.com/b#top"],
      "https://example.com/a": ["https://example.com/", "https://example.com/deep"],
      "https://example.com/b": ["https://example.com/deep"],
      "https://example.com/deep": [],
    };
    const check: AuditCheck = async (url) => page(url, graph[url] ?? []);
    const output = await crawlSite({
      seedUrl: "https://example.com/",
      check,
      limits: { maxPages: 10, maxDepth: 1, concurrency: 3, maxRetries: 0 },
    });
    expect(output.pages.map((result) => result.finalUrl)).toEqual([
      "https://example.com/",
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(output.stoppedBy).toBe("complete");
  });

  it("never queues external links and never exceeds max pages or concurrency", async () => {
    let active = 0;
    let peak = 0;
    const check: AuditCheck = async (url) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      const links = url.endsWith("/")
        ? [
            "https://example.com/1",
            "https://example.com/2",
            "https://example.com/3",
            "https://other.example/private",
          ]
        : [];
      return page(url, links);
    };
    const output = await crawlSite({
      seedUrl: "https://example.com/",
      check,
      limits: { maxPages: 3, maxDepth: 2, concurrency: 2, maxRetries: 0 },
    });
    expect(output.pages).toHaveLength(3);
    expect(output.pages.some((result) => result.finalUrl.includes("other.example"))).toBe(false);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("stops a retry loop at the tool-call ceiling", async () => {
    const check: AuditCheck = async () => {
      throw new Error("network");
    };
    await expect(crawlSite({
      seedUrl: "https://example.com/",
      check,
      limits: { maxPages: 10, maxToolCalls: 2, maxRetries: 2 },
    })).resolves.toMatchObject({ toolCalls: 2, retries: 2, pages: [] });
  });
});
