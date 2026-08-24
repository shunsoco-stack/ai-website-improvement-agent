import { describe, expect, it } from "vitest";
import type { SiteAuditResult } from "@/lib/site-audit/types";
import { fromSiteAuditResult } from "./audit-adapter";
import { synthesizeAudit } from "./synthesis";

describe("site-audit adapter", () => {
  it("maps deterministic backend evidence without inventing rendered contrast results", () => {
    const result: SiteAuditResult = {
      id: "page-1",
      inputUrl: "https://example.com/about",
      finalUrl: "https://example.com/about",
      statusCode: 200,
      statusKind: "ok",
      broken: false,
      redirectCount: 0,
      redirectChain: [],
      redirectLoop: false,
      redirectLimit: false,
      responseTimeMs: 120,
      contentType: "text/html",
      metadata: { title: "About", description: "", canonical: "", h1: "About", h1Count: 1 },
      accessibility: {
        imagesChecked: 2,
        missingAltCount: 1,
        controlsChecked: 3,
        unlabeledControlCount: 1,
        headingJumps: [{ from: 1, to: 3, text: "Details" }],
        contrast: { status: "manual_review", reason: "Computed styles are unavailable." },
      },
      contentSnippet: "Untrusted body",
      contentSnippetTruncated: false,
      contentSnippetTrust: "untrusted",
      technologyHints: [{ name: "Next.js", confidence: "high", evidence: "__next" }],
      internalLinks: [],
      externalLinks: [],
      issues: [],
      bodyReadable: true,
      bodyTruncated: false,
      checkedAt: "2026-08-25T00:00:00.000Z",
    };
    expect(fromSiteAuditResult(result, { depthByUrl: { [result.finalUrl]: 2 } })).toMatchObject({
      status: 200,
      depth: 2,
      metadata: { description: null, canonical: null },
      accessibility: {
        imageCount: 2,
        headingJumpCount: 1,
        contrast: "manual_review",
      },
      technologyHints: ["Next.js"],
    });
  });

  it("canonicalizes backend issue aliases so derived checks do not duplicate them", () => {
    const result: SiteAuditResult = {
      id: "missing-title",
      inputUrl: "https://example.com/untitled",
      finalUrl: "https://example.com/untitled",
      statusCode: 200,
      statusKind: "ok",
      broken: false,
      redirectCount: 0,
      redirectChain: [],
      redirectLoop: false,
      redirectLimit: false,
      responseTimeMs: 100,
      contentType: "text/html",
      metadata: { title: "", description: "Description", canonical: "https://example.com/untitled", h1: "Page", h1Count: 1 },
      accessibility: {
        imagesChecked: 0,
        missingAltCount: 0,
        controlsChecked: 0,
        unlabeledControlCount: 0,
        headingJumps: [],
        contrast: { status: "manual_review", reason: "Computed styles are unavailable." },
      },
      contentSnippet: "Page",
      contentSnippetTruncated: false,
      contentSnippetTrust: "untrusted",
      technologyHints: [],
      internalLinks: [],
      externalLinks: [],
      issues: [{
        id: "issue-title",
        code: "MISSING_TITLE",
        category: "content",
        severity: "high",
        title: "Title missing",
        url: "https://example.com/untitled",
        page: "Page",
        detectedFact: "title is empty",
        source: "HTML parser",
      }],
      bodyReadable: true,
      bodyTruncated: false,
      checkedAt: "2026-08-25T00:00:00.000Z",
    };
    const issues = synthesizeAudit([fromSiteAuditResult(result)]).issues;
    expect(issues.filter((issue) => issue.code === "TITLE_MISSING")).toHaveLength(1);
  });
});
