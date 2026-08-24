import { normalizeAuditUrl, normalizeText, createReinvestigationFingerprint } from "./fingerprints";
import { projectUsage } from "./guardrails";
import type {
  AgentGuardrails,
  AgentUsage,
  AuditPageInput,
  ImprovementIssue,
  ReinvestigationPlan,
  ReinvestigationTask,
  SkippedReinvestigation,
} from "./types";

export interface PlanReinvestigationOptions {
  guardrails: AgentGuardrails;
  usage: AgentUsage;
  completedLoopFingerprints?: readonly string[];
}

interface PatternCandidate {
  triggerCode: string;
  title: string;
  reason: string;
  pattern: string;
  issues: ImprovementIssue[];
}

function groupBy<T>(values: T[], keyFor: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
}

function buildPatternCandidates(pages: AuditPageInput[], issues: ImprovementIssue[]): PatternCandidate[] {
  const candidates: PatternCandidate[] = [];
  const duplicateTitleIssues = issues.filter((issue) => issue.code === "DUPLICATE_TITLE");
  const titleByUrl = new Map(pages.map((page) => [normalizeAuditUrl(page.finalUrl), normalizeText(page.metadata.title ?? "")]));
  for (const group of groupBy(duplicateTitleIssues, (issue) => titleByUrl.get(normalizeAuditUrl(issue.url)) ?? "").values()) {
    if (group.length < 2) continue;
    const title = pages.find((page) => normalizeAuditUrl(page.finalUrl) === normalizeAuditUrl(group[0].url))?.metadata.title;
    candidates.push({
      triggerCode: "DUPLICATE_TITLE_PATTERN",
      title: "重複TitleのTemplate Patternを追加調査",
      reason: `${group.length}ページで同一Titleを検出したため、関連Pageを追加確認します。`,
      pattern: `同一Title「${title ?? "未取得"}」が複数ページへ展開`,
      issues: group,
    });
  }

  const configs: Array<{
    code: string;
    triggerCode: string;
    title: string;
    reason: (count: number) => string;
    pattern: string;
  }> = [
    {
      code: "MISSING_ALT",
      triggerCode: "MISSING_ALT_PATTERN",
      title: "画像alt不足の登録Patternを追加調査",
      reason: (count) => `${count}ページでalt不足を検出したため、同系統Pageを確認します。`,
      pattern: "画像登録またはCMS Template単位でaltが不足",
    },
    {
      code: "CANONICAL_MISSING",
      triggerCode: "CANONICAL_PATTERN",
      title: "Canonical不足のTemplate Patternを追加調査",
      reason: (count) => `${count}ページでCanonical不足を検出したため、URL Patternを確認します。`,
      pattern: "同系統PageでCanonical生成Ruleが不足",
    },
    {
      code: "UNLABELED_CONTROL",
      triggerCode: "FORM_LABEL_PATTERN",
      title: "Form Label不足を追加調査",
      reason: (count) => `${count}ページでForm Label不足を検出したため、共通Componentを確認します。`,
      pattern: "共通Form Componentでaccessible nameが不足",
    },
  ];
  for (const config of configs) {
    const matching = issues.filter((issue) => issue.code === config.code);
    if (matching.length < 2) continue;
    candidates.push({
      triggerCode: config.triggerCode,
      title: config.title,
      reason: config.reason(matching.length),
      pattern: config.pattern,
      issues: matching,
    });
  }
  return candidates;
}

function findAdditionalUrls(
  pages: AuditPageInput[],
  relatedUrls: string[],
  limit: number,
): string[] {
  const audited = new Set(pages.map((page) => normalizeAuditUrl(page.finalUrl)));
  const related = new Set(relatedUrls.map(normalizeAuditUrl));
  const candidateLinks = pages
    .filter((page) => related.has(normalizeAuditUrl(page.finalUrl)))
    .flatMap((page) => page.internalLinks)
    .map((link) => {
      try {
        return normalizeAuditUrl(link.url);
      } catch {
        return null;
      }
    })
    .filter((url): url is string => Boolean(url) && !audited.has(url as string));
  return [...new Set(candidateLinks)].sort().slice(0, limit);
}

export function planReinvestigation(
  pages: AuditPageInput[],
  issues: ImprovementIssue[],
  options: PlanReinvestigationOptions,
): ReinvestigationPlan {
  const candidates = buildPatternCandidates(pages, issues);
  const completed = new Set(options.completedLoopFingerprints ?? []);
  const scheduled: ReinvestigationTask[] = [];
  const skipped: SkippedReinvestigation[] = [];
  let projectedUsage = { ...options.usage };

  for (const candidate of candidates) {
    const relatedUrls = [...new Set(candidate.issues.map((issue) => normalizeAuditUrl(issue.url)))].sort();
    const fingerprint = createReinvestigationFingerprint({
      triggerCode: candidate.triggerCode,
      pattern: candidate.pattern,
      relatedUrls,
    });
    if (completed.has(fingerprint)) {
      skipped.push({ fingerprint, triggerCode: candidate.triggerCode, reason: "loop_detected" });
      continue;
    }
    if (projectedUsage.reinvestigations >= options.guardrails.maxReinvestigations) {
      skipped.push({ fingerprint, triggerCode: candidate.triggerCode, reason: "reinvestigation_limit" });
      continue;
    }
    if (projectedUsage.toolCalls + 1 > options.guardrails.maxToolCalls) {
      skipped.push({ fingerprint, triggerCode: candidate.triggerCode, reason: "tool_call_limit" });
      continue;
    }
    const remainingPages = Math.max(0, options.guardrails.maxPages - projectedUsage.pagesCrawled);
    const requestedLimit = Math.min(options.guardrails.maxAdditionalPagesPerReinvestigation, remainingPages);
    const additionalUrls = findAdditionalUrls(pages, relatedUrls, requestedLimit);
    if (requestedLimit === 0 && additionalUrls.length === 0 && relatedUrls.length === 0) {
      skipped.push({ fingerprint, triggerCode: candidate.triggerCode, reason: "page_limit" });
      continue;
    }
    projectedUsage = projectUsage(projectedUsage, {
      pagesCrawled: additionalUrls.length,
      toolCalls: 1,
      reinvestigations: 1,
    });
    scheduled.push({
      id: `task-${fingerprint}`,
      fingerprint,
      triggerCode: candidate.triggerCode,
      title: candidate.title,
      reason: candidate.reason,
      pattern: candidate.pattern,
      relatedIssueFingerprints: candidate.issues.map((issue) => issue.fingerprint).sort(),
      relatedUrls,
      additionalUrls,
      status: "planned",
      retryCount: 0,
      maxRetries: options.guardrails.maxRetries,
    });
  }

  return { scheduled, skipped, projectedUsage };
}

export const planReinvestigations = planReinvestigation;
