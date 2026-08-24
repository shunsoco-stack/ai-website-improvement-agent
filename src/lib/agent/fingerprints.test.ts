import { describe, expect, it } from "vitest";
import {
  createEvidenceFingerprint,
  createIssueFingerprint,
  createReinvestigationFingerprint,
  normalizeAuditUrl,
} from "./fingerprints";

describe("stable fingerprints", () => {
  it("normalizes tracking parameters, fragments, query order, host, and trailing slash", () => {
    expect(normalizeAuditUrl("HTTPS://EXAMPLE.com/path/?utm_source=test&b=2&a=1#hero"))
      .toBe("https://example.com/path?a=1&b=2");
  });

  it("keeps an issue identity stable when only the detected fact text changes", () => {
    const input = { code: "TITLE_MISSING", url: "https://example.com/about", source: "HTML title" };
    expect(createIssueFingerprint(input)).toBe(createIssueFingerprint({ ...input }));
    expect(createEvidenceFingerprint({ ...input, detectedFact: "Titleなし" }))
      .not.toBe(createEvidenceFingerprint({ ...input, detectedFact: "Titleは空文字" }));
  });

  it("sorts related URLs for loop fingerprints", () => {
    const base = { triggerCode: "DUPLICATE_TITLE", pattern: "same template" };
    expect(createReinvestigationFingerprint({ ...base, relatedUrls: ["https://example.com/b", "https://example.com/a"] }))
      .toBe(createReinvestigationFingerprint({ ...base, relatedUrls: ["https://example.com/a", "https://example.com/b"] }));
  });
});
