import type { SiteAuditResult } from "@/lib/site-audit/types";
import type { AuditPageInput } from "./types";

export interface AuditAdapterOptions {
  depthByUrl?: Readonly<Record<string, number>>;
  defaultDepth?: number;
}

export function fromSiteAuditResult(
  result: SiteAuditResult,
  options: AuditAdapterOptions = {},
): AuditPageInput {
  const depth = options.depthByUrl?.[result.finalUrl] ?? options.depthByUrl?.[result.inputUrl] ?? options.defaultDepth ?? 0;
  const headingSequence = result.accessibility.headingJumps.flatMap((jump) => [jump.from, jump.to]);
  return {
    id: result.id,
    inputUrl: result.inputUrl,
    finalUrl: result.finalUrl,
    status: result.statusCode,
    statusKind: result.statusKind,
    statusLabel: result.statusCode === null ? result.statusKind : String(result.statusCode),
    redirectCount: result.redirectCount,
    responseTimeMs: result.responseTimeMs,
    contentType: result.contentType || null,
    metadata: {
      title: result.metadata.title || null,
      description: result.metadata.description || null,
      canonical: result.metadata.canonical || null,
      h1: result.metadata.h1 || null,
      h1Count: result.metadata.h1Count,
      lang: null,
      generator: null,
    },
    accessibility: {
      imageCount: result.accessibility.imagesChecked,
      missingAltCount: result.accessibility.missingAltCount,
      formControlCount: result.accessibility.controlsChecked,
      unlabeledControlCount: result.accessibility.unlabeledControlCount,
      emptyButtonCount: 0,
      headingSequence,
      headingJumpCount: result.accessibility.headingJumps.length,
      contrast: "manual_review",
    },
    contentSnippet: result.contentSnippet,
    technologyHints: result.technologyHints.map((hint) => hint.name),
    internalLinks: result.internalLinks.map((link) => ({ ...link })),
    externalLinks: result.externalLinks.map((link) => ({ ...link })),
    issues: result.issues.map((issue) => ({
      code: issue.code,
      category: issue.category,
      severity: issue.severity,
      title: issue.title,
      detectedFact: issue.detectedFact,
      source: issue.source,
    })),
    broken: result.broken,
    slow: result.issues.some((issue) => issue.code === "SLOW_RESPONSE"),
    checkedAt: result.checkedAt,
    depth,
  };
}

export function fromSiteAuditResults(
  results: SiteAuditResult[],
  options?: AuditAdapterOptions,
): AuditPageInput[] {
  return results.map((result) => fromSiteAuditResult(result, options));
}
