import { describe, expect, it } from "vitest";
import { compareRuns } from "./comparison";
import { getDemoPreviousRun, getDemoRun, getDemoScenarios } from "./demos";
import { assertWithinGuardrails, GuardrailError } from "./guardrails";
import {
  approveAgentPlan,
  approveHumanReview,
  createAgentRun,
  isTerminalAgentRun,
} from "./state-machine";

describe("agent workflow and demos", () => {
  it("creates an explicit 8-step plan and requires approval before running", () => {
    const run = createAgentRun({
      id: "test-run",
      goal: {
        targetUrl: "https://example.com",
        objectives: ["seo", "ux"],
        requestedDeliverable: "improvement_backlog",
      },
      crawl: { maxPages: 10, maxDepth: 2, concurrency: 2, timeoutMs: 5_000 },
      now: "2026-08-25T00:00:00.000Z",
    });
    expect(run.status).toBe("awaiting_plan_approval");
    expect(run.plan.steps).toHaveLength(8);
    expect(run.externalMutationPolicy).toBe("suggestions_only");
    expect(approveAgentPlan(run, "Reviewer", "2026-08-25T00:01:00.000Z").status).toBe("running");
    expect(() => approveHumanReview(run)).toThrow("Human Review");
  });

  it("provides three rich, completed Concept Project runs", () => {
    const scenarios = getDemoScenarios();
    expect(scenarios.map((scenario) => scenario.id)).toEqual(["corporate", "ecommerce", "landing_page"]);
    for (const scenario of scenarios) {
      const run = getDemoRun(scenario.id);
      expect(run.status).toBe("completed");
      expect(run.plan.steps).toHaveLength(8);
      expect(run.plan.steps.every((step) => step.status === "completed")).toBe(true);
      expect(run.auditPages.length).toBeGreaterThanOrEqual(3);
      expect(run.issues.length).toBeGreaterThanOrEqual(6);
      expect(run.humanReview).toMatchObject({ status: "approved", externalChangesApplied: false });
      expect(isTerminalAgentRun(run)).toBe(true);
      for (const phase of ["crawl", "check", "ai_analyze", "recheck", "report", "approval"] as const) {
        expect(run.activity.some((event) => event.phase === phase)).toBe(true);
      }
      expect(run.report?.issueCount).toBe(run.issues.length);
      expect(Object.values(run.report?.backlog ?? {}).flat()).toHaveLength(run.issues.length);
    }
  });

  it("compares Run A/B as improved, new, and unresolved using stable fingerprints", () => {
    const comparison = compareRuns(getDemoPreviousRun("corporate"), getDemoRun("corporate"));
    expect(comparison.summary.improved).toBeGreaterThan(0);
    expect(comparison.summary.newIssues).toBeGreaterThan(0);
    expect(comparison.summary.unresolved).toBeGreaterThan(0);
  });

  it("enforces pages, tool calls, retry, and duration limits", () => {
    const run = getDemoRun("landing_page");
    expect(() => assertWithinGuardrails(run.guardrails, {
      pagesCrawled: run.guardrails.maxPages + 1,
      toolCalls: run.guardrails.maxToolCalls + 1,
      retries: run.guardrails.maxRetries + 1,
      elapsedMs: run.guardrails.maxDurationMs + 1,
      reinvestigations: run.guardrails.maxReinvestigations + 1,
    })).toThrow(GuardrailError);
  });

  it("does not permit transitions out of the Human-approved terminal state", () => {
    const completed = getDemoRun("corporate");
    expect(() => approveHumanReview(completed)).toThrow("completed");
  });
});
