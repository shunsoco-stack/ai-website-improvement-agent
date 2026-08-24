import { describe, expect, it } from "vitest";
import { calculatePriority, mapBacklogBucket } from "./priority";

describe("deterministic priority rule", () => {
  it.each([
    [{ impact: 3, confidence: 3, effort: 1 } as const, 9, "high"],
    [{ impact: 3, confidence: 3, effort: 2 } as const, 4.5, "high"],
    [{ impact: 2, confidence: 3, effort: 3 } as const, 2, "medium"],
    [{ impact: 1, confidence: 1, effort: 3 } as const, 0.33, "low"],
  ])("uses Impact × Confidence ÷ Effort for %o", (factors, score, level) => {
    expect(calculatePriority(factors)).toMatchObject({
      formula: "impact * confidence / effort",
      score,
      level,
    });
  });

  it("maps urgent outages to Critical and small high-impact changes to Quick Win", () => {
    const outage = calculatePriority({ impact: 3, confidence: 3, effort: 2 });
    expect(mapBacklogBucket({
      code: "STATUS_500",
      severity: "critical",
      category: "technical",
      priority: outage,
    })).toBe("critical");

    const title = calculatePriority({ impact: 2, confidence: 3, effort: 1 });
    expect(mapBacklogBucket({
      code: "TITLE_MISSING",
      severity: "medium",
      category: "content",
      priority: title,
    })).toBe("quick_win");
  });

  it("rejects out-of-scale factors instead of asking AI to interpret them", () => {
    expect(() => calculatePriority({ impact: 4 as 3, confidence: 3, effort: 1 })).toThrow("Impact");
  });
});
