import type {
  AuditPageIssueInput,
  BacklogBucket,
  IssueCategory,
  IssueSeverity,
  PriorityAssessment,
  PriorityFactors,
} from "./types";

const QUICK_FIX_PATTERN = /(title|description|meta|canonical|h1|alt|label|empty_button|lang)/iu;
const LARGE_FIX_PATTERN = /(architecture|navigation|checkout|template|contrast|performance|slow|javascript)/iu;
const MATERIAL_IMPACT_PATTERN = /(broken|status_5|server|checkout|form|canonical|unlabeled|accessibility)/iu;

function assertScale(value: number, name: string): asserts value is 1 | 2 | 3 {
  if (![1, 2, 3].includes(value)) throw new Error(`${name}は1〜3で指定してください。`);
}

/**
 * Explicit deterministic rule:
 * score = impact (1..3) * confidence (1..3) / effort (1..3)
 * High >= 4.5, Medium >= 2.0, Low < 2.0.
 */
export function calculatePriority(factors: PriorityFactors): PriorityAssessment {
  assertScale(factors.impact, "Impact");
  assertScale(factors.confidence, "Confidence");
  assertScale(factors.effort, "Effort");
  const score = Number(((factors.impact * factors.confidence) / factors.effort).toFixed(2));
  const level = score >= 4.5 ? "high" : score >= 2 ? "medium" : "low";
  return {
    ...factors,
    formula: "impact * confidence / effort",
    score,
    level,
    rationale: `Impact ${factors.impact} × Confidence ${factors.confidence} ÷ Effort ${factors.effort} = ${score}`,
  };
}

export function normalizeIssueSeverity(value: AuditPageIssueInput["severity"]): IssueSeverity {
  const severity = value?.toLowerCase();
  if (severity === "critical") return "critical";
  if (severity === "high" || severity === "error") return "high";
  if (severity === "low" || severity === "info") return "low";
  return "medium";
}

export function derivePriorityFactors(input: {
  code: string;
  severity: IssueSeverity;
  category: IssueCategory;
}): PriorityFactors {
  const identity = `${input.code} ${input.category}`;
  const impact: 1 | 2 | 3 = input.severity === "critical" || input.severity === "high"
    ? 3
    : input.severity === "medium" || MATERIAL_IMPACT_PATTERN.test(identity)
      ? 2
      : 1;
  const confidence: 1 | 2 | 3 = /contrast|heuristic|manual/iu.test(identity) ? 1 : 3;
  const effort: 1 | 2 | 3 = QUICK_FIX_PATTERN.test(identity)
    ? 1
    : LARGE_FIX_PATTERN.test(identity)
      ? 3
      : 2;
  return { impact, confidence, effort };
}

export function mapBacklogBucket(input: {
  code: string;
  severity: IssueSeverity;
  category: IssueCategory;
  priority: PriorityAssessment;
}): BacklogBucket {
  if (
    input.severity === "critical" ||
    (input.priority.impact === 3 && /(broken|status_5|server|checkout_blocked)/iu.test(input.code))
  ) {
    return "critical";
  }
  if (input.priority.effort === 1 && input.priority.impact >= 2) return "quick_win";
  if (input.priority.impact >= 2 || input.priority.level === "high") return "medium_term";
  return "optional";
}
