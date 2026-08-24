import { stableHash } from "./fingerprints";
import {
  assertWithinGuardrails,
  DEFAULT_AGENT_GUARDRAILS,
  EMPTY_AGENT_USAGE,
  projectUsage,
  validateAgentGuardrails,
} from "./guardrails";
import { createImprovementPlan, updatePlanSteps, validateAgentGoal, validateCrawlConfiguration } from "./planner";
import { planReinvestigation } from "./reinvestigation";
import { synthesizeAudit } from "./synthesis";
import type {
  ActivityEvent,
  AgentGoal,
  AgentGuardrails,
  AgentRun,
  AuditPageInput,
  CrawlConfiguration,
  DemoScenarioId,
  IssueInterpretation,
} from "./types";

export interface CreateAgentRunInput {
  id?: string;
  mode?: AgentRun["mode"];
  scenarioId?: DemoScenarioId;
  goal: AgentGoal;
  crawl: CrawlConfiguration;
  guardrails?: Partial<AgentGuardrails>;
  now?: string;
}

export interface PrepareReviewOptions {
  now?: string;
  analysisDurationMs?: number;
  interpretationOverrides?: Readonly<Record<string, IssueInterpretation>>;
  completeReinvestigations?: boolean;
}

function timestamp(now?: string): string {
  const value = now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(value))) throw new Error("有効なISO時刻を指定してください。");
  return value;
}

function activity(
  run: Pick<AgentRun, "id" | "activity">,
  at: string,
  phase: ActivityEvent["phase"],
  status: ActivityEvent["status"],
  message: string,
  detail?: string,
): ActivityEvent {
  const identity = `${run.id}|${run.activity.length}|${at}|${phase}|${message}`;
  return { id: `activity-${stableHash(identity)}`, at, phase, status, message, detail };
}

function assertStatus(run: AgentRun, allowed: AgentRun["status"][], action: string): void {
  if (!allowed.includes(run.status)) throw new Error(`${run.status}では${action}できません。`);
}

export function isTerminalAgentRun(run: AgentRun): boolean {
  return run.status === "completed" || run.status === "stopped" || run.status === "failed";
}

export function createAgentRun(input: CreateAgentRunInput): AgentRun {
  const at = timestamp(input.now);
  const guardrails = validateAgentGuardrails({ ...DEFAULT_AGENT_GUARDRAILS, ...input.guardrails });
  const goal = validateAgentGoal(input.goal);
  const crawl = validateCrawlConfiguration(input.crawl, guardrails);
  const id = input.id ?? `run-${stableHash(`${goal.targetUrl}|${at}`)}`;
  const base: AgentRun = {
    schemaVersion: 1,
    id,
    mode: input.mode ?? "live",
    scenarioId: input.scenarioId,
    status: "awaiting_plan_approval",
    goal,
    crawl,
    guardrails,
    usage: { ...EMPTY_AGENT_USAGE },
    plan: createImprovementPlan(goal, at),
    auditPages: [],
    issues: [],
    reinvestigations: [],
    completedLoopFingerprints: [],
    activity: [],
    externalMutationPolicy: "suggestions_only",
    createdAt: at,
    updatedAt: at,
  };
  return {
    ...base,
    activity: [activity(
      base,
      at,
      "approval",
      "warning",
      "Goalから8段階の改善Planを作成しました。Human Approvalを待っています。",
      "External Websiteは変更せず、調査とSuggestionだけを行います。",
    )],
  };
}

export function approveAgentPlan(run: AgentRun, reviewer = "Human Reviewer", now?: string): AgentRun {
  assertStatus(run, ["awaiting_plan_approval"], "Planを承認");
  const at = timestamp(now);
  const nextPlan = {
    ...run.plan,
    status: "approved" as const,
    approvedAt: at,
    steps: run.plan.steps.map((step, index) => ({
      ...step,
      status: index === 0 ? "running" as const : "pending" as const,
    })),
  };
  return {
    ...run,
    status: "running",
    plan: nextPlan,
    activity: [...run.activity, activity(run, at, "approval", "completed", `${reviewer}がPlanを承認しました。Agentを開始します。`)],
    updatedAt: at,
  };
}

export function recordAuditResults(
  run: AgentRun,
  pages: AuditPageInput[],
  input: { now?: string; elapsedMs?: number; toolCalls?: number } = {},
): AgentRun {
  assertStatus(run, ["running"], "監査結果を記録");
  const at = timestamp(input.now);
  if (pages.length > run.crawl.maxPages) throw new Error(`Crawl結果がMax URL（${run.crawl.maxPages}）を超えています。`);
  const usage = projectUsage(run.usage, {
    pagesCrawled: pages.length,
    toolCalls: input.toolCalls ?? 2,
    elapsedMs: input.elapsedMs ?? 0,
  });
  assertWithinGuardrails(run.guardrails, usage);
  const plan = updatePlanSteps(run.plan, {
    site_crawl: "completed",
    metadata_check: "completed",
    broken_link_check: "completed",
    content_check: "completed",
    ux_accessibility_review: "completed",
    technical_ai_interpretation: "running",
  });
  const crawlEvent = activity(
    run,
    at,
    "crawl",
    "completed",
    `Crawl: ${pages.length}/${run.crawl.maxPages}ページをDepth ${run.crawl.maxDepth}以内で探索しました。`,
    `Concurrency ${run.crawl.concurrency} / Timeout ${run.crawl.timeoutMs}ms`,
  );
  const checkEvent = activity(
    { ...run, activity: [...run.activity, crawlEvent] },
    at,
    "check",
    "completed",
    "Check: HTTP、Metadata、Link、基本Accessibilityの決定論的確認を完了しました。",
  );
  return {
    ...run,
    usage,
    plan,
    auditPages: pages.map((page) => ({
      ...page,
      internalLinks: page.internalLinks.map((link) => ({ ...link })),
      externalLinks: page.externalLinks.map((link) => ({ ...link })),
      issues: page.issues.map((issue) => ({ ...issue })),
    })),
    activity: [...run.activity, crawlEvent, checkEvent],
    updatedAt: at,
  };
}

function completeReinvestigationIssues(
  tasks: AgentRun["reinvestigations"],
): AgentRun["reinvestigations"] {
  return tasks.map((task) => ({
    ...task,
    status: "completed" as const,
    finding: `${task.pattern}。${task.relatedUrls.length}ページの共通点を特定しました。`,
  }));
}

export function prepareRunForHumanReview(run: AgentRun, options: PrepareReviewOptions = {}): AgentRun {
  assertStatus(run, ["running"], "改善案を生成");
  if (run.auditPages.length === 0) throw new Error("分析する監査結果がありません。");
  const at = timestamp(options.now);
  const analysisUsage = projectUsage(run.usage, {
    toolCalls: 1,
    elapsedMs: options.analysisDurationMs ?? 0,
  });
  assertWithinGuardrails(run.guardrails, analysisUsage);
  const synthesis = synthesizeAudit(run.auditPages, options.interpretationOverrides);
  const recheckPlan = planReinvestigation(run.auditPages, synthesis.issues, {
    guardrails: run.guardrails,
    usage: analysisUsage,
    completedLoopFingerprints: run.completedLoopFingerprints,
  });
  const reportUsage = projectUsage(recheckPlan.projectedUsage, { toolCalls: 1 });
  assertWithinGuardrails(run.guardrails, reportUsage);
  const reinvestigations = options.completeReinvestigations === false
    ? recheckPlan.scheduled
    : completeReinvestigationIssues(recheckPlan.scheduled);
  const completedFingerprints = reinvestigations
    .filter((task) => task.status === "completed")
    .map((task) => task.fingerprint);
  const report = {
    generatedAt: at,
    issueCount: synthesis.issues.length,
    highPriorityCount: synthesis.issues.filter((issue) => issue.priority.level === "high").length,
    summary: `${run.auditPages.length}ページを監査し、${synthesis.issues.length}件の改善候補をEvidence付きで整理しました。`,
    categorySummary: synthesis.categorySummary,
    backlog: synthesis.backlog,
  };
  const analyzeEvent = activity(
    run,
    at,
    "ai_analyze",
    "completed",
    "AI Analyze: 決定論的Factから意味・Business Impact・Suggested Fixを構造化しました。",
    Object.values(options.interpretationOverrides ?? {}).some((value) => value.mode === "ai")
      ? "AI Structured Interpretation"
      : "Demo rule-based interpretation（AI Provider未使用）",
  );
  const recheckEvent = activity(
    { ...run, activity: [...run.activity, analyzeEvent] },
    at,
    "recheck",
    reinvestigations.length > 0 ? "completed" : "warning",
    reinvestigations.length > 0
      ? `Recheck: ${reinvestigations.length}件のPatternを追加調査しました。`
      : "Recheck: 追加調査が必要な反復Patternはありませんでした。",
    recheckPlan.skipped.length > 0 ? `${recheckPlan.skipped.length}件をGuardrailまたはLoop防止でSkip` : undefined,
  );
  const reportEvent = activity(
    { ...run, activity: [...run.activity, analyzeEvent, recheckEvent] },
    at,
    "report",
    "completed",
    "Report: PriorityとImprovement Backlogを作成し、Human Reviewへ送りました。",
  );
  return {
    ...run,
    status: "awaiting_human_review",
    usage: reportUsage,
    plan: updatePlanSteps(run.plan, {
      technical_ai_interpretation: "completed",
      priority_reinvestigation: "completed",
      improvement_plan_human_review: "needs_review",
    }),
    issues: synthesis.issues,
    reinvestigations,
    completedLoopFingerprints: [...new Set([...run.completedLoopFingerprints, ...completedFingerprints])],
    activity: [...run.activity, analyzeEvent, recheckEvent, reportEvent],
    report,
    humanReview: {
      status: "pending",
      requestedAt: at,
      externalChangesApplied: false,
    },
    updatedAt: at,
  };
}

export function approveHumanReview(
  run: AgentRun,
  input: { reviewer?: string; note?: string; now?: string } = {},
): AgentRun {
  assertStatus(run, ["awaiting_human_review"], "Human Reviewを承認");
  const at = timestamp(input.now);
  return {
    ...run,
    status: "completed",
    plan: {
      ...updatePlanSteps(run.plan, { improvement_plan_human_review: "completed" }),
      status: "completed",
      completedAt: at,
    },
    humanReview: {
      status: "approved",
      requestedAt: run.humanReview?.requestedAt ?? at,
      reviewedAt: at,
      reviewer: input.reviewer ?? "Human Reviewer",
      note: input.note?.trim() || "改善Planを承認",
      externalChangesApplied: false,
    },
    activity: [...run.activity, activity(
      run,
      at,
      "approval",
      "completed",
      "Human Reviewを完了しました。Suggestionを確定しました。",
      "External Websiteへの変更は実行していません。",
    )],
    updatedAt: at,
    finishedAt: at,
  };
}

export function requestHumanReviewChanges(
  run: AgentRun,
  note: string,
  now?: string,
): AgentRun {
  assertStatus(run, ["awaiting_human_review"], "修正を依頼");
  const at = timestamp(now);
  const trimmed = note.trim();
  if (!trimmed) throw new Error("修正依頼の内容を入力してください。");
  return {
    ...run,
    status: "changes_requested",
    humanReview: {
      status: "changes_requested",
      requestedAt: run.humanReview?.requestedAt ?? at,
      reviewedAt: at,
      note: trimmed,
      externalChangesApplied: false,
    },
    activity: [...run.activity, activity(run, at, "approval", "warning", `Human Reviewで修正を依頼しました: ${trimmed}`)],
    updatedAt: at,
  };
}

export function stopAgentRun(run: AgentRun, now?: string): AgentRun {
  assertStatus(run, ["running", "changes_requested"], "Runを停止");
  const at = timestamp(now);
  return {
    ...run,
    status: "stopped",
    activity: [...run.activity, activity(run, at, "guardrail", "blocked", "Agent Runを停止しました。")],
    updatedAt: at,
    finishedAt: at,
  };
}

export function createCompletedRunFromPages(
  input: CreateAgentRunInput & {
    pages: AuditPageInput[];
    reviewer?: string;
    completedAt?: string;
  },
): AgentRun {
  const created = createAgentRun(input);
  const approved = approveAgentPlan(created, input.reviewer ?? "Portfolio Demo Reviewer", input.now);
  const audited = recordAuditResults(approved, input.pages, { now: input.now, toolCalls: 2, elapsedMs: 8_000 });
  const review = prepareRunForHumanReview(audited, {
    now: input.now,
    analysisDurationMs: 4_000,
    completeReinvestigations: true,
  });
  return approveHumanReview(review, {
    reviewer: input.reviewer ?? "Portfolio Demo Reviewer",
    note: "DemoのImprovement Backlogを確認",
    now: input.completedAt ?? input.now,
  });
}
