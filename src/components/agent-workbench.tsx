"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  Download,
  Eye,
  FileSearch,
  Gauge,
  Globe2,
  Layers3,
  ListChecks,
  LockKeyhole,
  Network,
  PanelLeft,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Target,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import {
  approveAgentPlan,
  approveHumanReview,
  compareRuns,
  createAgentRun,
  getDemoComparison,
  getDemoRun,
  getDemoScenarios,
  planReinvestigation,
  prepareRunForHumanReview,
  recordAuditResults,
  requestHumanReviewChanges,
  stopAgentRun,
  synthesizeAudit,
  type ActivityEvent,
  type AgentRun,
  type AuditPageInput,
  type BacklogBucket,
  type DemoScenarioId,
  type ImprovementGoalKind,
  type ImprovementIssue,
  type IssueCategory,
  type IssueInterpretation,
  type RunComparison,
} from "@/lib/agent";
import {
  crawlSite,
  requestSiteAudit,
  type CrawlProgress,
} from "@/lib/client-crawl";
import type { SiteAuditResult } from "@/lib/site-audit/types";

type WorkspaceView = "activity" | "pages" | "issues" | "rechecks" | "backlog" | "compare";
type MobilePanel = "plan" | "workspace" | "review";
type SourceMode = "demo" | "live";
type CaptureScene = "plan" | "crawl" | "issues" | "issue-detail" | "backlog" | "compare";

interface ProgressState {
  percent: number;
  checked: number;
  total: number;
  currentUrl: string;
  label: string;
  toolCalls: number;
}

interface ToastState {
  kind: "success" | "info" | "error";
  title: string;
  message: string;
}

interface InterpretationResponse {
  provider: "openai" | "rule_based_demo" | "rule_based_fallback";
  label: string;
  warning?: string;
  interpretations: Array<{
    issueId: string;
    meaning: string;
    businessImpact: string;
    recommendation: string;
    uncertainty: string;
  }>;
}

const GOAL_OPTIONS: Array<{
  id: ImprovementGoalKind;
  label: string;
}> = [
  { id: "seo", label: "SEO改善" },
  { id: "ux", label: "UX改善" },
  { id: "conversion", label: "Conversion改善" },
  { id: "technical_audit", label: "Technical Audit" },
  { id: "renewal_research", label: "リニューアル調査" },
];

const VIEW_OPTIONS: Array<{
  id: WorkspaceView;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "activity", label: "Activity", icon: Activity },
  { id: "pages", label: "Pages", icon: Globe2 },
  { id: "issues", label: "Issues", icon: AlertTriangle },
  { id: "rechecks", label: "Rechecks", icon: RefreshCw },
  { id: "backlog", label: "Backlog", icon: Layers3 },
  { id: "compare", label: "Compare", icon: Gauge },
];

const CATEGORY_COPY: Record<IssueCategory, { label: string; description: string; icon: LucideIcon }> = {
  technical: { label: "Technical", description: "HTTP・速度・構造", icon: Wrench },
  content: { label: "Content", description: "Metadata・内容", icon: FileSearch },
  ux: { label: "UX", description: "導線・Conversion", icon: Target },
  accessibility: { label: "Accessibility", description: "alt・Heading・Label", icon: Eye },
};

const BACKLOG_COPY: Record<BacklogBucket, { label: string; caption: string }> = {
  critical: { label: "Critical", caption: "最優先で影響を止める" },
  quick_win: { label: "Quick Win", caption: "小さな工数で早く改善" },
  medium_term: { label: "Medium-term", caption: "設計・Template単位で改善" },
  optional: { label: "Optional", caption: "余力に応じて検討" },
};

const STATUS_COPY: Record<AgentRun["status"], string> = {
  awaiting_plan_approval: "Plan承認待ち",
  running: "Agent実行中",
  awaiting_human_review: "Human Review",
  changes_requested: "修正依頼あり",
  completed: "Review完了",
  stopped: "停止済み",
  failed: "実行失敗",
};

const SCENARIOS = getDemoScenarios();

function isScenario(value: string | null): value is DemoScenarioId {
  return value === "corporate" || value === "ecommerce" || value === "landing_page";
}

function isCaptureScene(value: string | null): value is CaptureScene {
  return value === "plan"
    || value === "crawl"
    || value === "issues"
    || value === "issue-detail"
    || value === "backlog"
    || value === "compare";
}

function cloneRun(run: AgentRun): AgentRun {
  return JSON.parse(JSON.stringify(run)) as AgentRun;
}

function runForScene(run: AgentRun, scene: CaptureScene): AgentRun {
  const next = cloneRun(run);
  if (scene === "plan") {
    next.status = "awaiting_plan_approval";
    next.plan.status = "draft";
    next.plan.steps = next.plan.steps.map((step) => ({ ...step, status: "pending" }));
    next.auditPages = [];
    next.issues = [];
    next.reinvestigations = [];
    next.report = undefined;
    next.humanReview = undefined;
    next.usage = { pagesCrawled: 0, toolCalls: 0, retries: 0, elapsedMs: 0, reinvestigations: 0 };
    next.activity = next.activity.slice(0, 1).map((event) => ({ ...event, status: "warning" }));
  } else if (scene === "crawl") {
    const visiblePages = Math.max(2, Math.ceil(next.auditPages.length * 0.45));
    next.status = "running";
    next.plan.status = "approved";
    next.plan.steps = next.plan.steps.map((step, index) => ({
      ...step,
      status: index === 0 ? "running" : "pending",
    }));
    next.auditPages = next.auditPages.slice(0, visiblePages);
    next.issues = [];
    next.reinvestigations = [];
    next.report = undefined;
    next.humanReview = undefined;
    next.usage = {
      pagesCrawled: visiblePages,
      toolCalls: visiblePages + 1,
      retries: 0,
      elapsedMs: 4_800,
      reinvestigations: 0,
    };
    next.activity = [
      ...next.activity.slice(0, 2),
      {
        id: "capture-crawl-running",
        at: next.updatedAt,
        phase: "crawl",
        status: "started",
        message: `Crawl: Depth 1を探索中（${visiblePages}/${run.auditPages.length} pages）`,
        detail: next.auditPages.at(-1)?.finalUrl,
      },
    ];
  }
  return next;
}

function runAwaitingHumanReview(run: AgentRun): AgentRun {
  const next = cloneRun(run);
  next.status = "awaiting_human_review";
  next.plan.status = "approved";
  next.plan.completedAt = undefined;
  next.plan.steps = next.plan.steps.map((step, index) => ({
    ...step,
    status: index === next.plan.steps.length - 1 ? "needs_review" : "completed",
  }));
  next.humanReview = {
    status: "pending",
    requestedAt: next.humanReview?.requestedAt ?? next.updatedAt,
    externalChangesApplied: false,
  };
  next.activity = next.activity.filter((event) => event.phase !== "approval");
  next.finishedAt = undefined;
  return next;
}

function viewForScene(scene: CaptureScene): WorkspaceView {
  if (scene === "plan") return "activity";
  if (scene === "crawl") return "activity";
  if (scene === "backlog") return "backlog";
  if (scene === "compare") return "compare";
  return "issues";
}

function statusTone(status: AgentRun["status"]): "running" | "review" | "done" {
  if (status === "running") return "running";
  if (status === "awaiting_plan_approval" || status === "awaiting_human_review" || status === "changes_requested") {
    return "review";
  }
  return "done";
}

function domainFor(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url || "URL未設定";
  }
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function statusKindForPage(page: AuditPageInput): "ok" | "redirect" | "error" | "blocked" {
  if (page.status === null || /blocked|failed/u.test(page.statusKind)) return "blocked";
  if (page.status >= 400) return "error";
  if (page.redirectCount > 0 || page.status >= 300) return "redirect";
  return "ok";
}

function scenarioIcon(id: DemoScenarioId): LucideIcon {
  if (id === "corporate") return Building2;
  if (id === "ecommerce") return ShoppingBag;
  return PanelLeft;
}

function phaseIcon(phase: ActivityEvent["phase"]): LucideIcon {
  switch (phase) {
    case "crawl": return Network;
    case "check": return ListChecks;
    case "ai_analyze": return Bot;
    case "recheck": return RefreshCw;
    case "report": return Layers3;
    case "approval": return ShieldCheck;
    case "guardrail": return LockKeyhole;
  }
}

function issueIcon(category: IssueCategory): LucideIcon {
  return CATEGORY_COPY[category].icon;
}

function normalizePriorityScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function adaptSiteAuditResult(
  result: SiteAuditResult,
  depth: number,
  sourcePage?: string,
): AuditPageInput {
  const accessibility = result.accessibility as SiteAuditResult["accessibility"] & {
    emptyButtonCount?: number;
  };
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
      generator: result.technologyHints[0]?.name ?? null,
    },
    accessibility: {
      imageCount: accessibility.imagesChecked,
      missingAltCount: accessibility.missingAltCount,
      formControlCount: accessibility.controlsChecked,
      unlabeledControlCount: accessibility.unlabeledControlCount,
      emptyButtonCount: accessibility.emptyButtonCount ?? 0,
      headingSequence: result.accessibility.headingJumps.flatMap((jump) => [jump.from, jump.to]),
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
      source: sourcePage ? `${issue.source} / linked from ${sourcePage}` : issue.source,
    })),
    broken: result.broken,
    slow: result.issues.some((issue) => issue.code === "SLOW_RESPONSE"),
    checkedAt: result.checkedAt,
    depth,
  };
}

async function requestInterpretations(
  pages: AuditPageInput[],
): Promise<{ overrides: Record<string, IssueInterpretation>; provider: string; warning?: string }> {
  const synthesis = synthesizeAudit(pages);
  const pageByUrl = new Map(pages.map((page) => [page.finalUrl, page]));
  const requestedIssues = synthesis.issues.slice(0, 24);
  if (requestedIssues.length === 0) return { overrides: {}, provider: "No issues" };
  const response = await fetch("/api/interpret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      findings: requestedIssues.map((issue) => ({
        issueId: issue.id,
        category: issue.category,
        title: issue.title,
        detectedFact: issue.evidence.map((evidence) => evidence.detectedFact).join(" / "),
        evidenceIds: issue.evidence.map((evidence) => evidence.id),
        untrustedContent: pageByUrl.get(issue.url)?.contentSnippet ?? "",
      })),
    }),
  });
  if (!response.ok) throw new Error(`Interpretation APIが ${response.status} を返しました。`);
  const payload = await response.json() as InterpretationResponse;
  const mode: IssueInterpretation["mode"] = payload.provider === "openai" ? "ai" : "demo_rule_based";
  const overrides = Object.fromEntries(payload.interpretations.map((item) => [
    item.issueId,
    {
      mode,
      meaning: item.meaning,
      businessImpact: item.businessImpact,
      recommendation: item.recommendation,
      groundedInEvidence: true,
      limitations: item.uncertainty,
    } satisfies IssueInterpretation,
  ]));
  return { overrides, provider: payload.label, warning: payload.warning };
}

function downloadRun(run: AgentRun) {
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${run.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function categoryCounts(run: AgentRun) {
  return (Object.keys(CATEGORY_COPY) as IssueCategory[]).map((category) => {
    const issues = run.issues.filter((issue) => issue.category === category);
    return {
      category,
      total: issues.length,
      high: issues.filter((issue) => issue.priority.level === "high").length,
    };
  });
}

function backlogFor(run: AgentRun, bucket: BacklogBucket): ImprovementIssue[] {
  return run.issues.filter((issue) => issue.backlog === bucket);
}

function MetricGrid({ run }: { run: AgentRun }) {
  return (
    <div className="metric-grid" aria-label="カテゴリ別Issue件数">
      {categoryCounts(run).map(({ category, total, high }) => {
        const copy = CATEGORY_COPY[category];
        const Icon = copy.icon;
        return (
          <article className="metric-card" data-category={category} key={category}>
            <div className="metric-card__top">
              <span className="metric-card__icon"><Icon size={14} /></span>
              <span className="metric-card__label">{copy.label}</span>
            </div>
            <strong>{total}</strong>
            <p>{high > 0 ? `High ${high}件` : copy.description}</p>
          </article>
        );
      })}
    </div>
  );
}

function ActivityView({ run, running }: { run: AgentRun; running: boolean }) {
  return (
    <div className="activity-list">
      {run.activity.map((event, index) => {
        const Icon = phaseIcon(event.phase);
        const status = running && index === run.activity.length - 1 ? "started" : event.status;
        return (
          <article className="activity-item" data-status={status} key={event.id}>
            <span className="activity-icon"><Icon size={15} /></span>
            <div className="activity-copy">
              <strong>{event.message}</strong>
              {event.detail && (event.detail.startsWith("http")
                ? <code>{event.detail}</code>
                : <p>{event.detail}</p>)}
            </div>
            <time className="activity-time" dateTime={event.at}>{formatTime(event.at)}</time>
          </article>
        );
      })}
    </div>
  );
}

function PagesView({ run }: { run: AgentRun }) {
  if (run.auditPages.length === 0) {
    return (
      <div className="empty-card">
        <Globe2 size={24} />
        <h3>まだPageを探索していません</h3>
        <p>Plan承認後、同一Originの内部URLだけをGuardrail内で探索します。</p>
      </div>
    );
  }
  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Page / URL</th>
            <th>Title</th>
            <th>Depth</th>
            <th>Time</th>
            <th>Signals</th>
          </tr>
        </thead>
        <tbody>
          {run.auditPages.map((page) => (
            <tr key={page.id}>
              <td><span className="http-status" data-kind={statusKindForPage(page)}>{page.status ?? "BLOCK"}</span></td>
              <td className="url-cell"><strong>{page.metadata.h1 || "名称未取得"}</strong><span>{page.finalUrl}</span></td>
              <td className="url-cell"><strong>{page.metadata.title || "Titleなし"}</strong><span>{page.redirectCount > 0 ? `${page.redirectCount} redirects` : page.contentType}</span></td>
              <td>{page.depth}</td>
              <td>{page.responseTimeMs === null ? "—" : `${page.responseTimeMs.toLocaleString()}ms`}</td>
              <td>{page.issues.length + page.accessibility.missingAltCount + page.accessibility.unlabeledControlCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IssuesView({
  run,
  selectedIssueId,
  onSelect,
  query,
  category,
}: {
  run: AgentRun;
  selectedIssueId: string | null;
  onSelect: (issue: ImprovementIssue) => void;
  query: string;
  category: IssueCategory | "all";
}) {
  const normalized = query.trim().toLocaleLowerCase("ja-JP");
  const issues = run.issues.filter((issue) => {
    if (category !== "all" && issue.category !== category) return false;
    if (!normalized) return true;
    return [issue.title, issue.url, issue.code, issue.page]
      .join(" ")
      .toLocaleLowerCase("ja-JP")
      .includes(normalized);
  });
  if (issues.length === 0) {
    return (
      <div className="empty-card">
        <Search size={24} />
        <h3>{run.issues.length === 0 ? "Issueはまだ生成されていません" : "条件に一致するIssueがありません"}</h3>
        <p>決定論的Checkの完了後、EvidenceとAI/Rule-based解釈を分離して表示します。</p>
      </div>
    );
  }
  return (
    <div className="issue-layout">
      <div className="issue-list">
        {issues.map((issue) => {
          const Icon = issueIcon(issue.category);
          return (
            <button
              className={`issue-row${selectedIssueId === issue.id ? " is-active" : ""}`}
              key={issue.id}
              onClick={() => onSelect(issue)}
              type="button"
            >
              <span className="issue-icon" data-category={issue.category}><Icon size={16} /></span>
              <span className="issue-copy">
                <span className="issue-copy__meta">
                  <span className="priority-pill" data-priority={issue.priority.level}>{issue.priority.level.toUpperCase()}</span>
                  <span className="category-pill">{CATEGORY_COPY[issue.category].label}</span>
                  {issue.origin === "agent_pattern" && <span className="mini-pill"><Sparkles size={9} /> Pattern</span>}
                </span>
                <strong>{issue.title}</strong>
                <p>{issue.page} · {issue.url}</p>
              </span>
              <span className="issue-score"><strong>{normalizePriorityScore(issue.priority.score)}</strong><span>score</span></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RechecksView({ run }: { run: AgentRun }) {
  if (run.reinvestigations.length === 0) {
    return (
      <div className="empty-card">
        <RefreshCw size={24} />
        <h3>追加調査Patternはありません</h3>
        <p>Title重複やalt・Label不足が複数ページで続くと、関連URLをGuardrail内で再確認します。</p>
      </div>
    );
  }
  return (
    <div>
      {run.reinvestigations.map((task) => (
        <article className="recheck-card" key={task.id}>
          <div className="recheck-card__top">
            <div>
              <span className="card-kicker"><RefreshCw size={11} /> Observation-driven Recheck</span>
              <h3>{task.title}</h3>
              <p>{task.reason}</p>
            </div>
            <span className="status-pill" data-status={task.status === "completed" ? "running" : "review"}>
              {task.status === "completed" ? <Check size={11} /> : <Clock3 size={11} />}
              {task.status}
            </span>
          </div>
          <div className="pattern-flow">
            <div className="pattern-node"><strong>Trigger</strong><span>{task.triggerCode}</span></div>
            <ArrowRight className="pattern-arrow" size={14} />
            <div className="pattern-node"><strong>Recheck</strong><span>{task.relatedUrls.length + task.additionalUrls.length} pages</span></div>
            <ArrowRight className="pattern-arrow" size={14} />
            <div className="pattern-node"><strong>Pattern</strong><span>{task.pattern}</span></div>
          </div>
          {task.finding && <div className="coverage-note" style={{ marginTop: "0.65rem" }}><Sparkles size={13} /><span>{task.finding}</span></div>}
        </article>
      ))}
    </div>
  );
}

function BacklogView({ run, onSelect }: { run: AgentRun; onSelect: (issue: ImprovementIssue) => void }) {
  return (
    <div className="backlog-board">
      {(Object.keys(BACKLOG_COPY) as BacklogBucket[]).map((bucket) => {
        const issues = backlogFor(run, bucket);
        return (
          <section className="backlog-column" key={bucket}>
            <div className="backlog-column__header">
              <div>
                <strong>{BACKLOG_COPY[bucket].label}</strong>
                <p style={{ margin: "0.12rem 0 0", color: "var(--ink-3)", fontSize: "0.55rem" }}>{BACKLOG_COPY[bucket].caption}</p>
              </div>
              <span className="count-pill">{issues.length}</span>
            </div>
            {issues.length === 0 ? (
              <p style={{ color: "var(--ink-3)", fontSize: "0.6rem" }}>該当なし</p>
            ) : issues.map((issue) => (
              <button className="backlog-item" key={issue.id} onClick={() => onSelect(issue)} type="button" style={{ width: "100%", textAlign: "left", background: "transparent", borderRight: 0, borderBottom: 0, borderLeft: 0 }}>
                <span><strong>{issue.title}</strong><span>{CATEGORY_COPY[issue.category].label} · {issue.page}</span></span>
                <ChevronRight size={13} />
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function CompareView({ comparison }: { comparison: RunComparison }) {
  const groups = [
    { key: "improved" as const, label: "改善済み", values: comparison.improved },
    { key: "new" as const, label: "新規問題", values: comparison.newIssues },
    { key: "unresolved" as const, label: "未解決", values: comparison.unresolved },
  ];
  return (
    <div>
      <div className="compare-summary">
        <article className="compare-stat" data-kind="improved"><strong>{comparison.summary.improved}</strong><span>改善済み</span></article>
        <article className="compare-stat" data-kind="new"><strong>{comparison.summary.newIssues}</strong><span>新規問題</span></article>
        <article className="compare-stat" data-kind="unresolved"><strong>{comparison.summary.unresolved}</strong><span>未解決</span></article>
      </div>
      <div className="compare-card">
        {groups.flatMap((group) => group.values.slice(0, 5).map((delta) => {
          const issue = delta.current ?? delta.previous;
          return (
            <div className="compare-row" key={`${group.key}-${delta.fingerprint}`}>
              {group.key === "improved" ? <CheckCircle2 size={15} color="var(--mint)" /> : group.key === "new" ? <AlertTriangle size={15} color="var(--red)" /> : <Clock3 size={15} color="var(--amber)" />}
              <span><strong>{issue?.title ?? delta.fingerprint}</strong><span>{issue?.url ?? "URLなし"}</span></span>
              <span className="mini-pill">{group.label}</span>
            </div>
          );
        }))}
      </div>
    </div>
  );
}

function IssueDetail({ issue, run }: { issue: ImprovementIssue; run: AgentRun }) {
  const task = run.reinvestigations.find((candidate) => candidate.relatedIssueFingerprints.includes(issue.fingerprint));
  return (
    <>
      <section className="review-section">
        <div className="detail-heading">
          <div className="detail-meta">
            <span className="priority-pill" data-priority={issue.priority.level}>{issue.priority.level.toUpperCase()}</span>
            <span className="category-pill">{CATEGORY_COPY[issue.category].label}</span>
            <span className="mini-pill">{issue.code}</span>
          </div>
          <h2>{issue.title}</h2>
        </div>
      </section>

      <section className="review-section">
        <div className="section-heading"><div><h3>Detected Fact</h3><p>AI解釈と分離した事実</p></div><LockKeyhole size={14} color="var(--mint)" /></div>
        <div className="fact-card">
          <span className="fact-card__label"><ListChecks size={11} /> Rule-based</span>
          <p>{issue.evidence[0]?.detectedFact ?? "検出事実なし"}</p>
          <code>{issue.url}</code>
        </div>
      </section>

      <section className="review-section">
        <div className="section-heading"><div><h3>Evidence</h3><p>URL / Page / Fact / Source</p></div><span className="count-pill">{issue.evidence.length}</span></div>
        <div className="evidence-list">
          {issue.evidence.slice(0, 4).map((evidence) => (
            <article className="evidence-card" key={evidence.id}>
              <dl>
                <dt>URL</dt><dd title={evidence.url}>{evidence.url}</dd>
                <dt>Page</dt><dd>{evidence.page}</dd>
                <dt>Fact</dt><dd>{evidence.detectedFact}</dd>
                <dt>Source</dt><dd>{evidence.source}</dd>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="review-section">
        <div className="section-heading"><div><h3>Issue Priority</h3><p>AIが上書きできない明示Rule</p></div><span className="priority-pill" data-priority={issue.priority.level}>{normalizePriorityScore(issue.priority.score)}</span></div>
        <div className="priority-card">
          <div className="priority-formula" aria-label="Impact掛けるConfidence割るEffort">
            <span className="formula-number"><strong>{issue.priority.impact}</strong><span>Impact</span></span>
            <span className="formula-symbol">×</span>
            <span className="formula-number"><strong>{issue.priority.confidence}</strong><span>Confidence</span></span>
            <span className="formula-symbol">÷</span>
            <span className="formula-number"><strong>{issue.priority.effort}</strong><span>Effort</span></span>
          </div>
          <p>{issue.priority.rationale}</p>
        </div>
      </section>

      <section className="review-section">
        <div className="section-heading">
          <div><h3>Interpretation</h3><p>意味・Business Impact・改善方針</p></div>
          <span className="provider-pill">{issue.interpretation.mode === "ai" ? <Bot size={11} /> : <Sparkles size={11} />}{issue.interpretation.mode === "ai" ? "AI" : "Demo Rule"}</span>
        </div>
        <div className="interpretation-card">
          <div className="interpretation-block"><strong>問題の意味</strong><p>{issue.interpretation.meaning}</p></div>
          <div className="interpretation-block"><strong>Business Impact</strong><p>{issue.interpretation.businessImpact}</p></div>
          <div className="interpretation-block"><strong>改善方針</strong><p>{issue.interpretation.recommendation}</p></div>
          {issue.interpretation.limitations && <div className="interpretation-block"><strong>不確実性</strong><p>{issue.interpretation.limitations}</p></div>}
        </div>
      </section>

      {task && (
        <section className="review-section">
          <div className="section-heading"><div><h3>Re-investigation</h3><p>観測から追加調査したPattern</p></div><RefreshCw size={14} color="var(--blue)" /></div>
          <div className="fact-card"><span className="fact-card__label"><Sparkles size={11} /> Confirmed Pattern</span><p>{task.finding ?? task.pattern}</p><code>{task.relatedUrls.length} related / {task.additionalUrls.length} additional URLs</code></div>
        </section>
      )}

      <section className="review-section">
        <div className="section-heading"><div><h3>Suggested Fix</h3><p>自動反映せず、差分をReview</p></div><Code2 size={14} color="var(--blue)" /></div>
        <div className="fix-card">
          <span className="card-kicker">{issue.suggestedFix.field}</span>
          <div className="fix-before-after">
            <div className="fix-value"><span>Before</span><code>{issue.suggestedFix.before || "未設定"}</code></div>
            <span className="fix-arrow"><ArrowRight size={14} /></span>
            <div className="fix-value"><span>Suggested</span><code>{issue.suggestedFix.suggested}</code></div>
          </div>
          {issue.suggestedFix.codeExample && <pre className="code-block">{issue.suggestedFix.codeExample}</pre>}
          <div className="technology-qualifier"><AlertTriangle size={11} /><span>{issue.suggestedFix.technologyQualifier ?? "実装技術は確認範囲内でのみ表示しています。"}</span></div>
        </div>
      </section>
    </>
  );
}

function HumanReviewCard({
  run,
  reviewNote,
  onNoteChange,
  onApprove,
  onRequestChanges,
}: {
  run: AgentRun;
  reviewNote: string;
  onNoteChange: (value: string) => void;
  onApprove: () => void;
  onRequestChanges: () => void;
}) {
  const pending = run.status === "awaiting_human_review";
  const approved = run.humanReview?.status === "approved";
  return (
    <section className="review-section">
      <div className="human-review-card">
        <span className="card-kicker"><ShieldCheck size={11} /> Human Review</span>
        <h3>{approved ? "改善Planは承認済みです" : pending ? "人間の判断を待っています" : "Suggestionのみを作成します"}</h3>
        <p>{approved ? `${run.humanReview?.reviewer ?? "Reviewer"}が確認。外部サイトは変更していません。` : "Agentは本番サイトを変更しません。承認はSuggestionの確定だけです。"}</p>
        {pending && (
          <>
            <label className="sr-only" htmlFor="review-note">Review note</label>
            <textarea id="review-note" className="review-note" value={reviewNote} onChange={(event) => onNoteChange(event.target.value)} placeholder="修正依頼や確認メモ（任意）" />
            <div className="review-actions">
              <button className="secondary-button" onClick={onRequestChanges} type="button">修正を依頼</button>
              <button className="primary-button" onClick={onApprove} type="button"><Check size={13} /> Planを承認</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function ReviewPane({
  run,
  selectedIssue,
  reviewNote,
  onNoteChange,
  onApprove,
  onRequestChanges,
}: {
  run: AgentRun;
  selectedIssue: ImprovementIssue | null;
  reviewNote: string;
  onNoteChange: (value: string) => void;
  onApprove: () => void;
  onRequestChanges: () => void;
}) {
  const high = run.issues.filter((issue) => issue.priority.level === "high").length;
  return (
    <aside className="panel panel-review" aria-label="ReviewとBacklog">
      <header className="panel-header">
        <div className="panel-title"><p className="eyebrow"><ShieldCheck size={11} /> Review</p><h2>Evidence & Suggestion</h2></div>
        <span className="safety-pill"><LockKeyhole size={11} /><span>本番変更なし</span></span>
      </header>
      <div className="panel-scroll review-content">
        <section className="review-section">
          <div className="run-summary-card">
            <div className="run-summary-card__top"><div><h3>{domainFor(run.goal.targetUrl)}</h3><p>{run.mode === "demo" ? "Concept Project / Demo Run" : "Live Website Audit"}</p></div><Globe2 size={18} /></div>
            <div className="run-summary-numbers">
              <div><strong>{run.auditPages.length}</strong><span>Pages</span></div>
              <div><strong>{run.issues.length}</strong><span>Issues</span></div>
              <div><strong>{high}</strong><span>High</span></div>
            </div>
          </div>
        </section>

        {selectedIssue ? <IssueDetail issue={selectedIssue} run={run} /> : (
          <section className="review-section issue-detail-empty"><FileSearch size={23} /><p>Issueを選ぶと、EvidenceとSuggested Fixを表示します。</p></section>
        )}

        <section className="review-section">
          <div className="section-heading"><div><h3>Accessibility範囲</h3><p>自動検出を誇張しません</p></div><Eye size={14} /></div>
          <div className="coverage-card">
            <div className="coverage-list">
              <div className="coverage-row"><strong>alt / accessible name</strong><span className="coverage-state"><Check size={11} /> Static check</span></div>
              <div className="coverage-row"><strong>Heading / Label</strong><span className="coverage-state"><Check size={11} /> Static check</span></div>
              <div className="coverage-row"><strong>Contrast / Keyboard</strong><span className="coverage-state is-manual"><Eye size={11} /> Human Review</span></div>
            </div>
          </div>
        </section>

        <HumanReviewCard run={run} reviewNote={reviewNote} onNoteChange={onNoteChange} onApprove={onApprove} onRequestChanges={onRequestChanges} />
      </div>
    </aside>
  );
}

export function AgentWorkbench() {
  const searchParams = useSearchParams();
  const demoParam = searchParams.get("demo");
  const sceneParam = searchParams.get("scene");
  const initialScenario: DemoScenarioId = isScenario(demoParam) ? demoParam : "corporate";
  const initialScene: CaptureScene = isCaptureScene(sceneParam) ? sceneParam : "plan";
  const initialFullRun = getDemoRun(initialScenario);

  const [scenarioId, setScenarioId] = useState<DemoScenarioId>(initialScenario);
  const [sourceMode, setSourceMode] = useState<SourceMode>("demo");
  const [run, setRun] = useState<AgentRun>(() => runForScene(initialFullRun, initialScene));
  const [targetUrl, setTargetUrl] = useState(initialFullRun.goal.targetUrl);
  const [goals, setGoals] = useState<ImprovementGoalKind[]>(initialFullRun.goal.objectives);
  const [maxPages, setMaxPages] = useState(initialFullRun.crawl.maxPages);
  const [maxDepth, setMaxDepth] = useState(initialFullRun.crawl.maxDepth);
  const [concurrency, setConcurrency] = useState(initialFullRun.crawl.concurrency);
  const [timeoutMs, setTimeoutMs] = useState(initialFullRun.crawl.timeoutMs);
  const [activeView, setActiveView] = useState<WorkspaceView>(viewForScene(initialScene));
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(
    initialScene === "plan" ? "plan" : initialScene === "issue-detail" ? "review" : "workspace",
  );
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(() => {
    const issue = initialScene === "issue-detail"
      ? initialFullRun.issues.find((candidate) => candidate.code === "DUPLICATE_TITLE") ?? initialFullRun.issues[0]
      : initialFullRun.issues[0];
    return issue?.id ?? null;
  });
  const [issueQuery, setIssueQuery] = useState("");
  const [issueCategory, setIssueCategory] = useState<IssueCategory | "all">("all");
  const [isRunning, setIsRunning] = useState(initialScene === "crawl");
  const [progress, setProgress] = useState<ProgressState>(() => ({
    percent: initialScene === "crawl" ? 47 : initialScene === "plan" ? 0 : 100,
    checked: initialScene === "crawl" ? Math.max(2, Math.ceil(initialFullRun.auditPages.length * 0.45)) : initialScene === "plan" ? 0 : initialFullRun.auditPages.length,
    total: initialFullRun.auditPages.length,
    currentUrl: initialScene === "crawl" ? initialFullRun.auditPages[Math.min(2, initialFullRun.auditPages.length - 1)]?.finalUrl ?? "" : "",
    label: initialScene === "crawl" ? "Depth 1の内部URLを探索中" : "Run ready",
    toolCalls: initialScene === "crawl" ? 5 : initialScene === "plan" ? 0 : initialFullRun.usage.toolCalls,
  }));
  const [toast, setToast] = useState<ToastState | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [previousLiveRun, setPreviousLiveRun] = useState<AgentRun | null>(null);
  const [providerLabel, setProviderLabel] = useState("Demo Rule-based Interpretation");
  const abortRef = useRef<AbortController | null>(null);
  const demoTimersRef = useRef<number[]>([]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4_200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem("website-agent:latest-run");
        if (stored) setPreviousLiveRun(JSON.parse(stored) as AgentRun);
      } catch {
        // Compare remains available through the deterministic demo if storage is unavailable.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    demoTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const effectiveSelectedIssueId = run.issues.some((issue) => issue.id === selectedIssueId)
    ? selectedIssueId
    : run.issues[0]?.id ?? null;

  const selectedIssue = useMemo(
    () => run.issues.find((issue) => issue.id === effectiveSelectedIssueId) ?? null,
    [effectiveSelectedIssueId, run.issues],
  );

  const comparison = useMemo<RunComparison>(() => {
    if (run.mode === "demo" && run.scenarioId) return getDemoComparison(run.scenarioId);
    if (previousLiveRun && previousLiveRun.id !== run.id) return compareRuns(previousLiveRun, run);
    return { runAId: "none", runBId: run.id, improved: [], newIssues: [], unresolved: [], summary: { improved: 0, newIssues: 0, unresolved: 0 } };
  }, [previousLiveRun, run]);

  const showToast = useCallback((next: ToastState) => setToast(next), []);

  const clearDemoTimers = useCallback(() => {
    demoTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    demoTimersRef.current = [];
  }, []);

  const switchScenario = useCallback((nextId: DemoScenarioId) => {
    clearDemoTimers();
    abortRef.current?.abort();
    const next = getDemoRun(nextId);
    const staged = runForScene(next, "plan");
    setScenarioId(nextId);
    setSourceMode("demo");
    setRun(staged);
    setTargetUrl(next.goal.targetUrl);
    setGoals(next.goal.objectives);
    setMaxPages(next.crawl.maxPages);
    setMaxDepth(next.crawl.maxDepth);
    setConcurrency(next.crawl.concurrency);
    setTimeoutMs(next.crawl.timeoutMs);
    setActiveView("activity");
    setMobilePanel("plan");
    setSelectedIssueId(null);
    setIsRunning(false);
    setProgress({ percent: 0, checked: 0, total: next.auditPages.length, currentUrl: "", label: "Plan approval", toolCalls: 0 });
  }, [clearDemoTimers]);

  const toggleGoal = useCallback((goal: ImprovementGoalKind) => {
    setGoals((current) => current.includes(goal)
      ? current.length === 1 ? current : current.filter((item) => item !== goal)
      : [...current, goal]);
  }, []);

  const selectIssue = useCallback((issue: ImprovementIssue) => {
    setSelectedIssueId(issue.id);
    setMobilePanel("review");
  }, []);

  const startDemoRun = useCallback(() => {
    clearDemoTimers();
    const full = getDemoRun(scenarioId);
    const running = runForScene(full, "crawl");
    setRun(running);
    setIsRunning(true);
    setActiveView("activity");
    setMobilePanel("workspace");
    setProviderLabel("Demo Rule-based Interpretation");
    const stages = [
      { at: 0, percent: 14, checked: 1, label: "Site Crawlを開始", url: full.auditPages[0]?.finalUrl ?? targetUrl, calls: 1 },
      { at: 750, percent: 38, checked: Math.min(2, full.auditPages.length), label: "HTTP・Metadataを決定論的に確認", url: full.auditPages[1]?.finalUrl ?? targetUrl, calls: 3 },
      { at: 1_500, percent: 61, checked: Math.min(4, full.auditPages.length), label: "Technical / Content / UX / Accessibilityを整理", url: full.auditPages[3]?.finalUrl ?? targetUrl, calls: 6 },
      { at: 2_250, percent: 79, checked: full.auditPages.length, label: "重複Patternを追加調査", url: full.reinvestigations[0]?.relatedUrls[0] ?? targetUrl, calls: 9 },
      { at: 3_050, percent: 94, checked: full.auditPages.length, label: "PriorityとBacklogを作成", url: "", calls: full.usage.toolCalls },
    ];
    for (const stage of stages) {
      const timer = window.setTimeout(() => setProgress({
        percent: stage.percent,
        checked: stage.checked,
        total: full.auditPages.length,
        currentUrl: stage.url,
        label: stage.label,
        toolCalls: stage.calls,
      }), stage.at);
      demoTimersRef.current.push(timer);
    }
    const complete = window.setTimeout(() => {
      const reviewReady = runAwaitingHumanReview(full);
      setRun(reviewReady);
      setIsRunning(false);
      setProgress({ percent: 100, checked: full.auditPages.length, total: full.auditPages.length, currentUrl: "", label: "Human Review待ち", toolCalls: full.usage.toolCalls });
      setActiveView("issues");
      const first = reviewReady.issues.find((issue) => issue.code === "DUPLICATE_TITLE") ?? reviewReady.issues[0];
      setSelectedIssueId(first?.id ?? null);
      showToast({ kind: "success", title: "Demo監査が完了しました", message: `${reviewReady.auditPages.length}ページ / ${reviewReady.issues.length} IssueをEvidence付きでHuman Reviewへ送りました。` });
    }, 3_850);
    demoTimersRef.current.push(complete);
  }, [clearDemoTimers, scenarioId, showToast, targetUrl]);

  const startLiveRun = useCallback(async () => {
    let created: AgentRun;
    try {
      created = createAgentRun({
        mode: "live",
        goal: {
          targetUrl,
          objectives: goals,
          requestedDeliverable: "improvement_backlog",
          businessContext: "URL入力からWeb改善機会を調査",
        },
        crawl: { maxPages, maxDepth, concurrency, timeoutMs },
        guardrails: {
          maxPages,
          maxToolCalls: Math.min(80, Math.max(20, maxPages * 2 + 8)),
          maxRetries: 1,
          maxDurationMs: 120_000,
          maxReinvestigations: 4,
          maxAdditionalPagesPerReinvestigation: 3,
        },
      });
    } catch (error) {
      showToast({ kind: "error", title: "Planを作成できません", message: error instanceof Error ? error.message : "入力を確認してください。" });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const approved = approveAgentPlan(created, "Workspace User");
    setRun(approved);
    setIsRunning(true);
    setActiveView("activity");
    setMobilePanel("workspace");
    setProgress({ percent: 3, checked: 0, total: maxPages, currentUrl: targetUrl, label: "Site Crawlを開始", toolCalls: 0 });

    try {
      const crawlCap = Math.max(1, maxPages - Math.min(3, Math.floor(maxPages / 4)));
      const output = await crawlSite({
        seedUrl: targetUrl,
        signal: controller.signal,
        limits: {
          maxPages: crawlCap,
          maxDepth,
          concurrency,
          timeoutMs,
          maxToolCalls: Math.min(60, Math.max(15, maxPages * 2)),
          maxRetries: 1,
          maxDurationMs: 90_000,
        },
        check: (url, context) => requestSiteAudit(url, { sourcePage: context.sourcePage, signal: context.signal }),
        onProgress: (next: CrawlProgress) => {
          const percent = Math.min(62, 8 + Math.round((next.checked / Math.max(1, crawlCap)) * 54));
          setProgress({ percent, checked: next.checked, total: maxPages, currentUrl: next.currentUrl, label: next.phase === "crawl" ? "内部URLを探索中" : "決定論的Checkを実行中", toolCalls: next.toolCalls });
        },
      });
      if (controller.signal.aborted) return;

      let pages = output.pages.map((page) => adaptSiteAuditResult(page, page.depth, page.sourcePage));
      setProgress((current) => ({ ...current, percent: 69, label: "Re-investigation候補を計画", currentUrl: "" }));
      const preliminary = synthesizeAudit(pages);
      const recheck = planReinvestigation(pages, preliminary.issues, {
        guardrails: approved.guardrails,
        usage: { pagesCrawled: pages.length, toolCalls: output.toolCalls, retries: output.retries, elapsedMs: 0, reinvestigations: 0 },
      });
      const additionalUrls = [...new Set(recheck.scheduled.flatMap((task) => task.additionalUrls))]
        .slice(0, Math.max(0, maxPages - pages.length));
      const additionalResults: AuditPageInput[] = [];
      for (const url of additionalUrls) {
        if (controller.signal.aborted) return;
        setProgress((current) => ({ ...current, percent: Math.min(78, current.percent + 2), label: "Patternを追加調査", currentUrl: url, toolCalls: current.toolCalls + 1 }));
        const result = await requestSiteAudit(url, { signal: controller.signal });
        additionalResults.push(adaptSiteAuditResult(result, maxDepth));
      }
      pages = [...pages, ...additionalResults].slice(0, maxPages);

      const audited = recordAuditResults(approved, pages, {
        toolCalls: output.toolCalls + additionalResults.length,
        elapsedMs: Math.min(90_000, approved.guardrails.maxDurationMs - 5_000),
      });
      setProgress((current) => ({ ...current, percent: 84, checked: pages.length, label: "AI Interpretationを構造化", currentUrl: "" }));
      let interpretationOverrides: Record<string, IssueInterpretation> = {};
      try {
        const interpreted = await requestInterpretations(pages);
        interpretationOverrides = interpreted.overrides;
        setProviderLabel(interpreted.provider);
        if (interpreted.warning) showToast({ kind: "info", title: "Rule-basedへ切替", message: interpreted.warning });
      } catch (error) {
        setProviderLabel("Rule-based fallback");
        showToast({ kind: "info", title: "監査Factは保持されています", message: `${error instanceof Error ? error.message : "AI処理失敗"} Rule-based解釈で続行します。` });
      }
      const review = prepareRunForHumanReview(audited, {
        interpretationOverrides,
        completeReinvestigations: true,
        analysisDurationMs: 3_000,
      });
      setRun(review);
      setIsRunning(false);
      setProgress({ percent: 100, checked: pages.length, total: maxPages, currentUrl: "", label: "Human Review待ち", toolCalls: review.usage.toolCalls });
      setActiveView("issues");
      setSelectedIssueId(review.issues[0]?.id ?? null);
      showToast({ kind: "success", title: "監査Reportを作成しました", message: `${pages.length}ページを確認し、${review.issues.length}件をHuman Reviewへ送りました。` });
    } catch (error) {
      if (controller.signal.aborted) {
        showToast({ kind: "info", title: "Runを停止しました", message: "完了済みの画面状態を保持しています。" });
      } else {
        showToast({ kind: "error", title: "監査を完了できませんでした", message: error instanceof Error ? error.message : "安全上の制限または接続Errorです。" });
      }
      setIsRunning(false);
    } finally {
      abortRef.current = null;
    }
  }, [concurrency, goals, maxDepth, maxPages, showToast, targetUrl, timeoutMs]);

  const startRun = useCallback(() => {
    if (isRunning) return;
    if (sourceMode === "demo") startDemoRun();
    else void startLiveRun();
  }, [isRunning, sourceMode, startDemoRun, startLiveRun]);

  const stopRun = useCallback(() => {
    abortRef.current?.abort();
    clearDemoTimers();
    setIsRunning(false);
    setRun((current) => {
      try {
        return current.status === "running" ? stopAgentRun(current) : current;
      } catch {
        return current;
      }
    });
    setProgress((current) => ({ ...current, label: "Runを停止しました", currentUrl: "" }));
  }, [clearDemoTimers]);

  const approveReview = useCallback(() => {
    if (run.status !== "awaiting_human_review") return;
    const approved = approveHumanReview(run, { reviewer: "Workspace User", note: reviewNote || "改善Planを確認" });
    setRun(approved);
    try {
      if (previousLiveRun?.id !== approved.id) window.localStorage.setItem("website-agent:latest-run", JSON.stringify(approved));
    } catch {
      // Approval remains valid even when local persistence is unavailable.
    }
    showToast({ kind: "success", title: "Human Reviewを完了しました", message: "Suggestionを確定しました。本番サイトへの変更は行っていません。" });
  }, [previousLiveRun, reviewNote, run, showToast]);

  const requestChanges = useCallback(() => {
    if (run.status !== "awaiting_human_review") return;
    if (!reviewNote.trim()) {
      showToast({ kind: "error", title: "修正内容を入力してください", message: "Review noteにAgentへ戻す内容を記入します。" });
      return;
    }
    setRun(requestHumanReviewChanges(run, reviewNote));
    showToast({ kind: "info", title: "修正を依頼しました", message: "外部サイトは変更せず、PlanだけをReview対象として保持します。" });
  }, [reviewNote, run, showToast]);

  const viewCount = useCallback((view: WorkspaceView) => {
    if (view === "pages") return run.auditPages.length;
    if (view === "issues") return run.issues.length;
    if (view === "rechecks") return run.reinvestigations.length;
    if (view === "backlog") return run.issues.length;
    if (view === "compare") return comparison.summary.improved + comparison.summary.newIssues + comparison.summary.unresolved;
    return run.activity.length;
  }, [comparison.summary, run]);

  const contentCopy: Record<WorkspaceView, { title: string; caption: string }> = {
    activity: { title: "Agent Activity", caption: "Crawl → Check → AI Analyze → Recheck → Report" },
    pages: { title: "Explored Pages", caption: "同一Origin・Depth・Status・Metadataの確認結果" },
    issues: { title: "Issue Dashboard", caption: "事実と解釈を分離し、明示Ruleで優先順位付け" },
    rechecks: { title: "Re-investigation", caption: "観測したPatternから追加調査したAgent Task" },
    backlog: { title: "Improvement Backlog", caption: "Critical / Quick Win / Medium-term / Optional" },
    compare: { title: "Run A vs Run B", caption: "改善済み・新規問題・未解決をFingerprintで比較" },
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div className="brand-copy"><strong>AI Webサイト改善エージェント</strong><span>WEB IMPROVEMENT & AUDIT AGENT</span></div>
        </div>
        <div className="run-context">
          <span className="status-pill" data-status={statusTone(run.status)}>
            {isRunning ? <RefreshCw size={11} className="loading-mark" style={{ width: 12, height: 12, border: 0 }} /> : run.status === "completed" ? <CheckCircle2 size={11} /> : <Clock3 size={11} />}
            {STATUS_COPY[run.status]}
          </span>
          <span className="provider-pill"><Bot size={11} /> {providerLabel}</span>
        </div>
        <div className="topbar-actions">
          <span className="safety-pill"><LockKeyhole size={11} /><span>Suggestions only</span></span>
          <button className="ghost-button" onClick={() => setActiveView("compare")} type="button"><Gauge size={13} /> Compare</button>
          <button className="icon-button" aria-label="Run JSONをDownload" onClick={() => downloadRun(run)} type="button"><Download size={15} /></button>
        </div>
      </header>

      <main className="app-shell">
        <div className="workspace-grid" data-mobile-active={mobilePanel}>
          <aside className="panel panel-plan" aria-label="GoalとPlan">
            <header className="panel-header">
              <div className="panel-title"><p className="eyebrow"><Target size={11} /> Agent Goal</p><h2>Goal & Plan</h2></div>
              <span className="mini-pill">8 steps</span>
            </header>
            <div className="panel-scroll left-content">
              <section className="form-section">
                <div className="section-heading"><div><h3>監査Source</h3><p>Demoまたは権限のある公開URL</p></div></div>
                <div className="goal-grid" style={{ marginBottom: "0.65rem" }}>
                  <button className={`goal-chip${sourceMode === "demo" ? " is-active" : ""}`} onClick={() => setSourceMode("demo")} type="button">{sourceMode === "demo" && <span className="goal-chip__check"><Check size={9} /></span>}Demo Mode</button>
                  <button className={`goal-chip${sourceMode === "live" ? " is-active" : ""}`} onClick={() => setSourceMode("live")} type="button">{sourceMode === "live" && <span className="goal-chip__check"><Check size={9} /></span>}Live URL</button>
                </div>
                {sourceMode === "demo" && (
                  <div className="scenario-grid">
                    {SCENARIOS.map((scenario) => {
                      const Icon = scenarioIcon(scenario.id);
                      return <button className={`scenario-button${scenarioId === scenario.id ? " is-active" : ""}`} key={scenario.id} onClick={() => switchScenario(scenario.id)} type="button"><Icon size={15} /><span>{scenario.label}</span></button>;
                    })}
                  </div>
                )}
              </section>

              <section className="form-section">
                <label className="field-label" htmlFor="target-url">対象WebサイトURL</label>
                <div className="url-field"><Globe2 size={14} /><input id="target-url" className="text-input" value={targetUrl} onChange={(event) => { setTargetUrl(event.target.value); if (sourceMode === "demo" && event.target.value !== run.goal.targetUrl) setSourceMode("live"); }} placeholder="https://example.com" inputMode="url" /></div>
                <div className="permission-note"><ShieldCheck size={13} /><span>監査権限のある公開サイトだけを指定してください。SSRF防御と負荷上限を適用し、robots.txt・利用規約の確認は利用者が行います。</span></div>
              </section>

              <section className="form-section">
                <div className="section-heading"><div><h3>Agent Goal</h3><p>複数選択できます</p></div><span className="count-pill">{goals.length}</span></div>
                <div className="goal-grid">
                  {GOAL_OPTIONS.map((option) => {
                    const selected = goals.includes(option.id);
                    return <button className={`goal-chip${selected ? " is-active" : ""}`} key={option.id} onClick={() => toggleGoal(option.id)} type="button">{selected && <span className="goal-chip__check"><Check size={9} /></span>}{option.label}</button>;
                  })}
                </div>
              </section>

              <section className="form-section">
                <div className="section-heading"><div><h3>Crawl Limits</h3><p>BrowserとBackendの両側で制限</p></div><Network size={14} color="var(--blue)" /></div>
                <div className="limit-grid">
                  <label className="limit-field"><span>Max URL</span><input type="number" min={3} max={50} value={maxPages} onChange={(event) => setMaxPages(Math.min(50, Math.max(3, Number(event.target.value))))} /></label>
                  <label className="limit-field"><span>Depth</span><select value={maxDepth} onChange={(event) => setMaxDepth(Number(event.target.value))}>{[0, 1, 2, 3].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                  <label className="limit-field"><span>Concurrency</span><select value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))}>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                  <label className="limit-field"><span>Timeout</span><select value={timeoutMs} onChange={(event) => setTimeoutMs(Number(event.target.value))}>{[4000, 8000, 12000, 15000].map((value) => <option key={value} value={value}>{value / 1000}s</option>)}</select></label>
                </div>
                <div className="guardrail-strip">
                  <div className="guardrail-mini"><strong>{Math.min(80, Math.max(20, maxPages * 2 + 8))}</strong><span>Tool Calls</span></div>
                  <div className="guardrail-mini"><strong>1</strong><span>Max Retry</span></div>
                  <div className="guardrail-mini"><strong>120s</strong><span>Duration</span></div>
                </div>
              </section>

              <section className="form-section">
                <div className="section-heading"><div><h3>Improvement Plan</h3><p>実行前にHuman Approval</p></div><span className="mini-pill">v1</span></div>
                <ol className="plan-list">
                  {run.plan.steps.map((step) => (
                    <li className={`plan-step is-${step.status}`} key={step.id}>
                      <span className="plan-step__number">{step.status === "completed" ? <Check size={10} /> : step.order}</span>
                      <span className="plan-step__copy"><strong>{step.label}</strong><span>{step.description}</span></span>
                      <span className="plan-step__state">{step.status === "running" ? <RefreshCw size={11} /> : step.status === "needs_review" ? <Eye size={11} /> : <span />}</span>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
            <div className="plan-action">
              {isRunning ? <button className="danger-button full-button" onClick={stopRun} type="button"><Pause size={13} /> Runを停止</button> : <button className="primary-button full-button" onClick={startRun} type="button"><Play size={13} /> {sourceMode === "demo" ? "Planを承認してDemo実行" : "Planを承認して監査開始"}</button>}
            </div>
          </aside>

          <section className="panel panel-center" aria-label="Agent Workspace">
            <header className="panel-header workspace-header">
              <div className="workspace-title-row"><span className="domain-avatar"><Globe2 size={16} /></span><div className="panel-title"><p className="eyebrow">CURRENT RUN</p><h1>{domainFor(run.goal.targetUrl)}</h1></div></div>
              <span className="status-pill" data-status={statusTone(run.status)}>{isRunning ? <Zap size={11} /> : run.status === "completed" ? <CheckCircle2 size={11} /> : <Clock3 size={11} />}{STATUS_COPY[run.status]}</span>
            </header>

            {isRunning && (
              <div className="progress-banner" role="status" aria-live="polite">
                <span className="progress-orbit" aria-hidden="true" />
                <div className="progress-copy"><strong>{progress.label}</strong><span>{progress.currentUrl || "Guardrail内で次のTaskを選択しています"}</span></div>
                <div className="progress-stat"><strong>{progress.checked}/{progress.total}</strong><span>{progress.toolCalls} tool calls</span></div>
                <div className="progress-track"><span style={{ width: `${progress.percent}%` }} /></div>
              </div>
            )}

            <nav className="workspace-tabs" aria-label="Workspace View">
              {VIEW_OPTIONS.map((option) => {
                const Icon = option.icon;
                return <button className={`workspace-tab${activeView === option.id ? " is-active" : ""}`} key={option.id} onClick={() => setActiveView(option.id)} type="button"><Icon size={13} />{option.label}<span className="count-pill">{viewCount(option.id)}</span></button>;
              })}
            </nav>

            <div className="panel-scroll workspace-content">
              <div className="content-toolbar">
                <div className="content-heading"><h2>{contentCopy[activeView].title}</h2><p>{contentCopy[activeView].caption}</p></div>
                {activeView === "issues" && (
                  <div className="toolbar-actions">
                    <label className="search-wrap"><span className="sr-only">Issue検索</span><Search size={13} /><input className="search-input" value={issueQuery} onChange={(event) => setIssueQuery(event.target.value)} placeholder="Issue / URLを検索" /></label>
                    <select className="select-input" style={{ width: "auto", minHeight: "2.35rem", padding: "0.4rem 1.8rem 0.4rem 0.65rem", fontSize: "0.66rem" }} value={issueCategory} onChange={(event) => setIssueCategory(event.target.value as IssueCategory | "all")} aria-label="カテゴリFilter"><option value="all">All</option>{(Object.keys(CATEGORY_COPY) as IssueCategory[]).map((category) => <option key={category} value={category}>{CATEGORY_COPY[category].label}</option>)}</select>
                  </div>
                )}
              </div>

              {activeView === "issues" && <MetricGrid run={run} />}
              {activeView === "activity" && <ActivityView run={run} running={isRunning} />}
              {activeView === "pages" && <PagesView run={run} />}
              {activeView === "issues" && <IssuesView run={run} selectedIssueId={effectiveSelectedIssueId} onSelect={selectIssue} query={issueQuery} category={issueCategory} />}
              {activeView === "rechecks" && <RechecksView run={run} />}
              {activeView === "backlog" && <BacklogView run={run} onSelect={selectIssue} />}
              {activeView === "compare" && <CompareView comparison={comparison} />}
            </div>
          </section>

          <ReviewPane run={run} selectedIssue={selectedIssue} reviewNote={reviewNote} onNoteChange={setReviewNote} onApprove={approveReview} onRequestChanges={requestChanges} />
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Mobile workspace navigation">
        <button className={mobilePanel === "plan" ? "is-active" : ""} onClick={() => setMobilePanel("plan")} type="button"><Target size={16} />Plan</button>
        <button className={mobilePanel === "workspace" ? "is-active" : ""} onClick={() => setMobilePanel("workspace")} type="button"><Activity size={16} />Workspace</button>
        <button className={mobilePanel === "review" ? "is-active" : ""} onClick={() => setMobilePanel("review")} type="button"><ShieldCheck size={16} />Review</button>
      </nav>

      {toast && (
        <div className="toast" data-kind={toast.kind} role={toast.kind === "error" ? "alert" : "status"}>
          {toast.kind === "error" ? <AlertTriangle size={16} /> : toast.kind === "success" ? <CheckCircle2 size={16} /> : <Sparkles size={16} />}
          <span><strong>{toast.title}</strong><span>{toast.message}</span></span>
          <button className="icon-button" style={{ width: 30, minWidth: 30, height: 30, minHeight: 30, marginLeft: "auto" }} aria-label="通知を閉じる" onClick={() => setToast(null)} type="button"><X size={13} /></button>
        </div>
      )}
    </>
  );
}
