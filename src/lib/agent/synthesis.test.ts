import { describe, expect, it } from "vitest";
import { getDemoRun } from "./demos";
import { synthesizeAudit } from "./synthesis";

describe("audit synthesis", () => {
  const run = getDemoRun("corporate");
  const synthesis = synthesizeAudit(run.auditPages);

  it("keeps deterministic facts and interpretations separate across all categories", () => {
    for (const category of ["technical", "content", "ux", "accessibility"] as const) {
      expect(synthesis.categorySummary[category].total).toBeGreaterThan(0);
    }
    expect(synthesis.issues.every((issue) => issue.evidence.length > 0)).toBe(true);
    expect(synthesis.issues.every((issue) => issue.interpretation.groundedInEvidence)).toBe(true);
    expect(synthesis.issues.every((issue) => issue.evidence.every((evidence) =>
      Boolean(evidence.url && evidence.page && evidence.detectedFact && evidence.source),
    ))).toBe(true);
  });

  it("detects duplicate titles across pages and supplies a Before → Suggested fix", () => {
    const duplicate = synthesis.issues.find((issue) => issue.code === "DUPLICATE_TITLE");
    expect(duplicate).toBeDefined();
    expect(duplicate?.suggestedFix).toMatchObject({ field: "Title" });
    expect(duplicate?.suggestedFix.before).toContain("サービス");
    expect(duplicate?.suggestedFix.suggested).not.toBe(duplicate?.suggestedFix.before);
  });

  it("never claims contrast was automatically verified", () => {
    const accessibility = synthesis.issues.find((issue) => issue.category === "accessibility");
    expect(accessibility?.interpretation.limitations).toContain("Human Review");
  });
});
