export const IMPROVEMENT_GOALS = [
  "seo",
  "ux",
  "conversion",
  "technical_audit",
  "renewal_research",
] as const;

export type ImprovementGoalKind = (typeof IMPROVEMENT_GOALS)[number];

export const ISSUE_CATEGORIES = ["technical", "content", "ux", "accessibility"] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const ISSUE_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export type PriorityLevel = "high" | "medium" | "low";
export type BacklogBucket = "critical" | "quick_win" | "medium_term" | "optional";

export type PlanStepStatus = "pending" | "running" | "completed" | "needs_review";
export type AgentRunStatus =
  | "awaiting_plan_approval"
  | "running"
  | "awaiting_human_review"
  | "changes_requested"
  | "completed"
  | "stopped"
  | "failed";

export type DemoScenarioId = "corporate" | "ecommerce" | "landing_page";

export interface AgentGoal {
  targetUrl: string;
  objectives: ImprovementGoalKind[];
  businessContext?: string;
  requestedDeliverable: "improvement_backlog";
}

export interface CrawlConfiguration {
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  timeoutMs: number;
}

export interface AgentGuardrails {
  maxPages: number;
  maxToolCalls: number;
  maxRetries: number;
  maxDurationMs: number;
  maxReinvestigations: number;
  maxAdditionalPagesPerReinvestigation: number;
}

export interface AgentUsage {
  pagesCrawled: number;
  toolCalls: number;
  retries: number;
  elapsedMs: number;
  reinvestigations: number;
}

export interface ImprovementPlanStep {
  id:
    | "site_crawl"
    | "metadata_check"
    | "broken_link_check"
    | "content_check"
    | "ux_accessibility_review"
    | "technical_ai_interpretation"
    | "priority_reinvestigation"
    | "improvement_plan_human_review";
  order: number;
  label: string;
  description: string;
  status: PlanStepStatus;
}

export interface ImprovementPlan {
  id: string;
  version: 1;
  status: "draft" | "approved" | "completed";
  goalSummary: string;
  steps: ImprovementPlanStep[];
  createdAt: string;
  approvedAt?: string;
  completedAt?: string;
}

export interface AuditLinkInput {
  url: string;
  text?: string;
  scope?: "internal" | "external" | "unknown";
}

export interface AuditPageIssueInput {
  code: string;
  category?: IssueCategory | "seo" | string;
  severity?: IssueSeverity | "error" | "warning" | "info" | string;
  title?: string;
  detectedFact?: string;
  source?: string;
  locator?: string;
  suggestedValue?: string;
}

/**
 * Stable, UI-independent input expected from the deterministic site-audit layer.
 * The API adapter may map its richer SiteAuditResult into this structural type.
 */
export interface AuditPageInput {
  id: string;
  inputUrl: string;
  finalUrl: string;
  status: number | null;
  statusKind: string;
  statusLabel: string;
  redirectCount: number;
  responseTimeMs: number | null;
  contentType: string | null;
  metadata: {
    title: string | null;
    description: string | null;
    canonical: string | null;
    h1: string | null;
    h1Count: number;
    lang?: string | null;
    generator?: string | null;
  };
  accessibility: {
    imageCount: number;
    missingAltCount: number;
    formControlCount: number;
    unlabeledControlCount: number;
    emptyButtonCount: number;
    headingSequence: number[];
    headingJumpCount: number;
    contrast: "manual_review";
  };
  contentSnippet: string;
  technologyHints: Array<string | { name: string; confidence?: number }>;
  internalLinks: AuditLinkInput[];
  externalLinks: AuditLinkInput[];
  issues: AuditPageIssueInput[];
  broken: boolean;
  slow: boolean;
  checkedAt: string;
  depth: number;
}

export interface PriorityFactors {
  /** Business/user impact: 1 (limited) ... 3 (material). */
  impact: 1 | 2 | 3;
  /** Confidence in the deterministic observation: 1 ... 3. */
  confidence: 1 | 2 | 3;
  /** Relative implementation effort: 1 (small) ... 3 (large). */
  effort: 1 | 2 | 3;
}

export interface PriorityAssessment extends PriorityFactors {
  formula: "impact * confidence / effort";
  score: number;
  level: PriorityLevel;
  rationale: string;
}

export interface IssueEvidence {
  id: string;
  fingerprint: string;
  url: string;
  page: string;
  detectedFact: string;
  source: string;
  locator?: string;
  checkedAt: string;
}

export interface IssueInterpretation {
  mode: "ai" | "demo_rule_based";
  meaning: string;
  businessImpact: string;
  recommendation: string;
  groundedInEvidence: boolean;
  limitations?: string;
}

export interface SuggestedFix {
  field: string;
  before: string;
  suggested: string;
  codeExample?: string;
  technologyQualifier?: string;
}

export interface ImprovementIssue {
  id: string;
  fingerprint: string;
  code: string;
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  url: string;
  page: string;
  origin: "deterministic" | "agent_pattern";
  evidence: IssueEvidence[];
  priority: PriorityAssessment;
  backlog: BacklogBucket;
  interpretation: IssueInterpretation;
  suggestedFix: SuggestedFix;
  detectedAt: string;
}

export interface CategorySummary {
  category: IssueCategory;
  total: number;
  high: number;
  medium: number;
  low: number;
}

export interface AuditSynthesis {
  issues: ImprovementIssue[];
  categorySummary: Record<IssueCategory, CategorySummary>;
  backlog: Record<BacklogBucket, ImprovementIssue[]>;
}

export interface ReinvestigationTask {
  id: string;
  fingerprint: string;
  triggerCode: string;
  title: string;
  reason: string;
  pattern: string;
  relatedIssueFingerprints: string[];
  relatedUrls: string[];
  additionalUrls: string[];
  status: "planned" | "completed" | "skipped";
  retryCount: number;
  maxRetries: number;
  finding?: string;
}

export interface SkippedReinvestigation {
  fingerprint: string;
  triggerCode: string;
  reason: "loop_detected" | "reinvestigation_limit" | "page_limit" | "tool_call_limit";
}

export interface ReinvestigationPlan {
  scheduled: ReinvestigationTask[];
  skipped: SkippedReinvestigation[];
  projectedUsage: AgentUsage;
}

export interface ActivityEvent {
  id: string;
  at: string;
  phase: "crawl" | "check" | "ai_analyze" | "recheck" | "report" | "approval" | "guardrail";
  status: "started" | "completed" | "warning" | "blocked";
  message: string;
  detail?: string;
}

export interface HumanReview {
  status: "pending" | "approved" | "changes_requested";
  requestedAt: string;
  reviewedAt?: string;
  reviewer?: string;
  note?: string;
  /** The product never mutates an external website. */
  externalChangesApplied: false;
}

export interface ImprovementReport {
  generatedAt: string;
  issueCount: number;
  highPriorityCount: number;
  summary: string;
  categorySummary: Record<IssueCategory, CategorySummary>;
  backlog: Record<BacklogBucket, ImprovementIssue[]>;
}

export interface AgentRun {
  schemaVersion: 1;
  id: string;
  mode: "live" | "demo";
  scenarioId?: DemoScenarioId;
  status: AgentRunStatus;
  goal: AgentGoal;
  crawl: CrawlConfiguration;
  guardrails: AgentGuardrails;
  usage: AgentUsage;
  plan: ImprovementPlan;
  auditPages: AuditPageInput[];
  issues: ImprovementIssue[];
  reinvestigations: ReinvestigationTask[];
  completedLoopFingerprints: string[];
  activity: ActivityEvent[];
  report?: ImprovementReport;
  humanReview?: HumanReview;
  externalMutationPolicy: "suggestions_only";
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface IssueDelta {
  fingerprint: string;
  status: "improved" | "new" | "unresolved";
  previous?: ImprovementIssue;
  current?: ImprovementIssue;
}

export interface RunComparison {
  runAId: string;
  runBId: string;
  improved: IssueDelta[];
  newIssues: IssueDelta[];
  unresolved: IssueDelta[];
  summary: {
    improved: number;
    newIssues: number;
    unresolved: number;
  };
}

export interface UntrustedContentEnvelope {
  readonly version: 1;
  readonly kind: "untrusted_web_content";
  readonly trust: "untrusted";
  readonly sourceUrl: string;
  readonly content: string;
  readonly contentFingerprint: string;
  readonly promptInjectionSignals: readonly string[];
  readonly instructionsMustNotBeFollowed: true;
}
