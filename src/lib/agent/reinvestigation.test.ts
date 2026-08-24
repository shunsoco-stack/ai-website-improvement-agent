import { describe, expect, it } from "vitest";
import { getDemoRun } from "./demos";
import { EMPTY_AGENT_USAGE } from "./guardrails";
import { planReinvestigation } from "./reinvestigation";

describe("re-investigation planner", () => {
  const run = getDemoRun("corporate");

  it("turns repeated title/canonical findings into bounded follow-up tasks", () => {
    const plan = planReinvestigation(run.auditPages, run.issues, {
      guardrails: run.guardrails,
      usage: { ...EMPTY_AGENT_USAGE, pagesCrawled: run.auditPages.length },
    });
    expect(plan.scheduled.some((task) => task.triggerCode === "DUPLICATE_TITLE_PATTERN")).toBe(true);
    expect(plan.scheduled.every((task) => task.additionalUrls.length <= run.guardrails.maxAdditionalPagesPerReinvestigation)).toBe(true);
    expect(plan.projectedUsage.toolCalls).toBe(plan.scheduled.length);
  });

  it("uses stable loop fingerprints to prevent the same observation from scheduling itself", () => {
    const plan = planReinvestigation(run.auditPages, run.issues, {
      guardrails: run.guardrails,
      usage: { ...EMPTY_AGENT_USAGE, pagesCrawled: run.auditPages.length },
      completedLoopFingerprints: run.completedLoopFingerprints,
    });
    expect(plan.scheduled).toHaveLength(0);
    expect(plan.skipped.some((item) => item.reason === "loop_detected")).toBe(true);
  });

  it("stops scheduling at Max Re-investigation", () => {
    const plan = planReinvestigation(run.auditPages, run.issues, {
      guardrails: run.guardrails,
      usage: {
        ...EMPTY_AGENT_USAGE,
        pagesCrawled: run.auditPages.length,
        reinvestigations: run.guardrails.maxReinvestigations,
      },
    });
    expect(plan.scheduled).toHaveLength(0);
    expect(plan.skipped.every((item) => item.reason === "reinvestigation_limit")).toBe(true);
  });
});
