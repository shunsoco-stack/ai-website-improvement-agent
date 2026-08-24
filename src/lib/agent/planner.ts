import { normalizeAuditUrl, stableHash } from "./fingerprints";
import type {
  AgentGoal,
  AgentGuardrails,
  CrawlConfiguration,
  ImprovementPlan,
  ImprovementPlanStep,
} from "./types";

const PLAN_STEP_DEFINITIONS: ReadonlyArray<Omit<ImprovementPlanStep, "status">> = [
  { id: "site_crawl", order: 1, label: "Site Crawl", description: "同一Originの内部URLを制限付きで探索します。" },
  { id: "metadata_check", order: 2, label: "Metadata確認", description: "Title、Description、Canonical、H1を通常コードで確認します。" },
  { id: "broken_link_check", order: 3, label: "Broken Link確認", description: "Status、Redirect、リンク切れ、Response Timeを確認します。" },
  { id: "content_check", order: 4, label: "Content確認", description: "ページ内容と重複・不足PatternをEvidence付きで整理します。" },
  { id: "ux_accessibility_review", order: 5, label: "UX・Accessibility整理", description: "導線、alt、Heading、Labelなど自動検出可能な範囲を確認します。" },
  { id: "technical_ai_interpretation", order: 6, label: "Technical Issues・AI Interpretation", description: "決定論的Factを分離したまま意味・Business Impact・改善案を構造化します。" },
  { id: "priority_reinvestigation", order: 7, label: "Priority設定・追加調査", description: "明示Ruleで優先順位を付け、Pattern候補を再調査します。" },
  { id: "improvement_plan_human_review", order: 8, label: "Improvement Plan・Human Review", description: "BacklogとSuggested Fixを作成し、人間の承認を待ちます。" },
];

export function validateAgentGoal(goal: AgentGoal): AgentGoal {
  const target = new URL(goal.targetUrl);
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error("監査対象URLはHTTP/HTTPSで指定してください。");
  }
  if (goal.objectives.length === 0) throw new Error("Goalを1件以上選択してください。");
  return {
    ...goal,
    targetUrl: normalizeAuditUrl(target.toString()),
    objectives: [...new Set(goal.objectives)],
    businessContext: goal.businessContext?.trim() || undefined,
  };
}

export function validateCrawlConfiguration(
  crawl: CrawlConfiguration,
  guardrails: AgentGuardrails,
): CrawlConfiguration {
  if (!Number.isInteger(crawl.maxPages) || crawl.maxPages < 1 || crawl.maxPages > guardrails.maxPages) {
    throw new Error(`Max Pagesは1〜${guardrails.maxPages}で指定してください。`);
  }
  if (!Number.isInteger(crawl.maxDepth) || crawl.maxDepth < 0 || crawl.maxDepth > 5) {
    throw new Error("Depthは0〜5で指定してください。");
  }
  if (!Number.isInteger(crawl.concurrency) || crawl.concurrency < 1 || crawl.concurrency > 6) {
    throw new Error("Concurrencyは1〜6で指定してください。");
  }
  if (!Number.isInteger(crawl.timeoutMs) || crawl.timeoutMs < 1_000 || crawl.timeoutMs > 30_000) {
    throw new Error("Timeoutは1,000〜30,000msで指定してください。");
  }
  return { ...crawl };
}

export function createImprovementPlan(goalInput: AgentGoal, now: string): ImprovementPlan {
  const goal = validateAgentGoal(goalInput);
  const goalLabels = goal.objectives.join(" / ");
  return {
    id: `plan-${stableHash(`${goal.targetUrl}|${goalLabels}`)}`,
    version: 1,
    status: "draft",
    goalSummary: `${goal.targetUrl} を対象に ${goalLabels} の改善機会を調査します。`,
    steps: PLAN_STEP_DEFINITIONS.map((step) => ({ ...step, status: "pending" })),
    createdAt: now,
  };
}

export function updatePlanSteps(
  plan: ImprovementPlan,
  updates: Partial<Record<ImprovementPlanStep["id"], ImprovementPlanStep["status"]>>,
): ImprovementPlan {
  return {
    ...plan,
    steps: plan.steps.map((step) => ({ ...step, status: updates[step.id] ?? step.status })),
  };
}
