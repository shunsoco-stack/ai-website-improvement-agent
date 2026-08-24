import {
  createEvidenceFingerprint,
  createIssueFingerprint,
  normalizeText,
} from "./fingerprints";
import {
  calculatePriority,
  derivePriorityFactors,
  mapBacklogBucket,
  normalizeIssueSeverity,
} from "./priority";
import type {
  AuditPageInput,
  AuditPageIssueInput,
  AuditSynthesis,
  BacklogBucket,
  CategorySummary,
  ImprovementIssue,
  IssueCategory,
  IssueInterpretation,
  IssueSeverity,
  SuggestedFix,
} from "./types";

interface FindingSeed extends AuditPageIssueInput {
  code: string;
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  detectedFact: string;
  source: string;
}

const BACKLOG_BUCKETS: BacklogBucket[] = ["critical", "quick_win", "medium_term", "optional"];

function normalizeCategory(issue: AuditPageIssueInput): IssueCategory {
  const category = issue.category?.toLowerCase();
  if (category === "technical" || category === "content" || category === "ux" || category === "accessibility") {
    return category;
  }
  const code = issue.code.toLowerCase();
  if (/(alt|label|heading|button|accessibility|a11y|contrast|lang)/u.test(code)) return "accessibility";
  if (/(title|description|content|h1|duplicate|copy)/u.test(code)) return "content";
  if (/(cta|conversion|navigation|form|journey|checkout|usability)/u.test(code)) return "ux";
  return "technical";
}

function canonicalIssueCode(value: string): string {
  const code = value.toUpperCase();
  return ({
    MISSING_TITLE: "TITLE_MISSING",
    MISSING_DESCRIPTION: "DESCRIPTION_MISSING",
    MISSING_CANONICAL: "CANONICAL_MISSING",
    MISSING_H1: "H1_MISSING",
    MULTIPLE_H1: "H1_MULTIPLE",
    HTTP_SERVER_ERROR: "STATUS_5XX",
    HTTP_CLIENT_ERROR: "BROKEN_PAGE",
  } as Record<string, string>)[code] ?? code;
}

function seed(input: AuditPageIssueInput & {
  code: string;
  category?: AuditPageIssueInput["category"];
  severity?: AuditPageIssueInput["severity"];
  title: string;
  detectedFact: string;
  source: string;
}): FindingSeed {
  return {
    ...input,
    code: canonicalIssueCode(input.code),
    category: normalizeCategory(input),
    severity: normalizeIssueSeverity(input.severity),
    title: input.title,
    detectedFact: input.detectedFact,
    source: input.source,
  };
}

function collectPageFindings(page: AuditPageInput): FindingSeed[] {
  const findings: FindingSeed[] = page.issues.map((issue) => seed({
    ...issue,
    title: issue.title ?? issue.code.replace(/_/gu, " "),
    detectedFact: issue.detectedFact ?? `${issue.code}を検出しました。`,
    source: issue.source ?? "Deterministic audit rule",
  }));

  if (page.status !== null && page.status >= 500) {
    findings.push(seed({
      code: "STATUS_5XX",
      category: "technical",
      severity: "critical",
      title: "Server Error",
      detectedFact: `HTTP ${page.status}を返しました。`,
      source: "HTTP status",
    }));
  } else if (page.broken || (page.status !== null && page.status >= 400)) {
    findings.push(seed({
      code: "BROKEN_PAGE",
      category: "technical",
      severity: "critical",
      title: "Broken Page",
      detectedFact: `HTTP ${page.status ?? "取得失敗"}でページへ到達できません。`,
      source: "HTTP status",
    }));
  }

  if (page.redirectCount >= 2) findings.push(seed({
    code: "REDIRECT_CHAIN",
    category: "technical",
    severity: "medium",
    title: "Redirect Chain",
    detectedFact: `${page.redirectCount}回のRedirectを経由しています。`,
    source: "HTTP redirect chain",
  }));
  if (page.slow) findings.push(seed({
    code: "SLOW_RESPONSE",
    category: "technical",
    severity: "high",
    title: "Response Timeが遅い",
    detectedFact: `Response Timeは${page.responseTimeMs ?? "不明"}msでした。`,
    source: "HTTP response timing",
  }));
  if (!page.metadata.title?.trim()) findings.push(seed({
    code: "TITLE_MISSING",
    category: "content",
    severity: "high",
    title: "Titleが未設定",
    detectedFact: "<title>が空または存在しません。",
    source: "HTML <title>",
  }));
  if (!page.metadata.description?.trim()) findings.push(seed({
    code: "DESCRIPTION_MISSING",
    category: "content",
    severity: "medium",
    title: "Meta Descriptionが未設定",
    detectedFact: "meta[name=description]が空または存在しません。",
    source: "HTML meta[name=description]",
  }));
  if (!page.metadata.canonical?.trim()) findings.push(seed({
    code: "CANONICAL_MISSING",
    category: "technical",
    severity: "medium",
    title: "Canonicalが未設定",
    detectedFact: "link[rel=canonical]が存在しません。",
    source: "HTML link[rel=canonical]",
  }));
  if (page.metadata.h1Count === 0) findings.push(seed({
    code: "H1_MISSING",
    category: "content",
    severity: "medium",
    title: "H1が未設定",
    detectedFact: "ページ内にH1要素がありません。",
    source: "DOM h1 count",
  }));
  if (page.metadata.h1Count > 1) findings.push(seed({
    code: "H1_MULTIPLE",
    category: "content",
    severity: "low",
    title: "H1が複数存在",
    detectedFact: `H1要素を${page.metadata.h1Count}件検出しました。`,
    source: "DOM h1 count",
  }));
  if (page.accessibility.missingAltCount > 0) findings.push(seed({
    code: "MISSING_ALT",
    category: "accessibility",
    severity: "medium",
    title: "画像のaltが不足",
    detectedFact: `${page.accessibility.imageCount}画像中${page.accessibility.missingAltCount}件でalt不足を検出しました。`,
    source: "DOM img alt attribute",
  }));
  if (page.accessibility.unlabeledControlCount > 0) findings.push(seed({
    code: "UNLABELED_CONTROL",
    category: "accessibility",
    severity: "high",
    title: "Form ControlにLabelがない",
    detectedFact: `${page.accessibility.formControlCount} controls中${page.accessibility.unlabeledControlCount}件にaccessible labelがありません。`,
    source: "DOM form control accessible name",
  }));
  if (page.accessibility.emptyButtonCount > 0) findings.push(seed({
    code: "EMPTY_BUTTON",
    category: "accessibility",
    severity: "high",
    title: "Accessible NameのないButton",
    detectedFact: `${page.accessibility.emptyButtonCount}件の空Buttonを検出しました。`,
    source: "DOM button accessible name",
  }));
  if (page.accessibility.headingJumpCount > 0) findings.push(seed({
    code: "HEADING_JUMP",
    category: "accessibility",
    severity: "medium",
    title: "Heading階層が不連続",
    detectedFact: `Heading levelの飛び越しを${page.accessibility.headingJumpCount}件検出しました。`,
    source: "DOM heading sequence",
  }));

  const deduplicated = new Map<string, FindingSeed>();
  for (const finding of findings) {
    const key = finding.code;
    if (!deduplicated.has(key)) deduplicated.set(key, finding);
  }
  return [...deduplicated.values()];
}

function duplicateTitleFindings(pages: AuditPageInput[]): Map<string, FindingSeed[]> {
  const titleGroups = new Map<string, AuditPageInput[]>();
  for (const page of pages) {
    const normalized = normalizeText(page.metadata.title ?? "");
    if (!normalized) continue;
    titleGroups.set(normalized, [...(titleGroups.get(normalized) ?? []), page]);
  }
  const byPage = new Map<string, FindingSeed[]>();
  for (const group of titleGroups.values()) {
    if (group.length < 2) continue;
    const urls = group.map((page) => page.finalUrl).join("、");
    for (const page of group) {
      const finding = seed({
        code: "DUPLICATE_TITLE",
        category: "content",
        severity: "high",
        title: "Titleが重複",
        detectedFact: `同一Title「${page.metadata.title}」を${group.length}ページで検出しました: ${urls}`,
        source: "Cross-page HTML <title> comparison",
      });
      byPage.set(page.id, [...(byPage.get(page.id) ?? []), finding]);
    }
  }
  return byPage;
}

function defaultInterpretation(seedValue: FindingSeed): IssueInterpretation {
  const code = seedValue.code;
  if (/BROKEN|STATUS_5/u.test(code)) return {
    mode: "demo_rule_based",
    meaning: "訪問者とCrawlerが対象ページへ正常に到達できません。",
    businessImpact: "主要導線の離脱、検索評価の毀損、Conversion機会の損失につながります。",
    recommendation: "参照元と配信状態を確認し、200応答へ復旧するか適切な転送先を設定してください。",
    groundedInEvidence: true,
  };
  if (/DUPLICATE_TITLE/u.test(code)) return {
    mode: "demo_rule_based",
    meaning: "複数ページが同じ検索結果見出しを共有し、ページの違いが伝わりにくい状態です。",
    businessImpact: "検索意図との対応が曖昧になり、クリック率やページ識別性が下がる可能性があります。",
    recommendation: "各ページ固有の主題を先頭に置き、テンプレート単位でTitle生成Ruleを修正してください。",
    groundedInEvidence: true,
  };
  if (/TITLE|DESCRIPTION|H1/u.test(code)) return {
    mode: "demo_rule_based",
    meaning: "ページの主題を示すMetadataまたは見出しが不足しています。",
    businessImpact: "検索結果とページ内で内容を理解しにくくなり、発見性と回遊性へ影響します。",
    recommendation: "ページ固有の目的と検索意図に沿った短く具体的な文言を設定してください。",
    groundedInEvidence: true,
  };
  if (/ALT|LABEL|BUTTON|HEADING/u.test(code)) return {
    mode: "demo_rule_based",
    meaning: "支援技術が画像・操作・文書構造を十分に理解できない可能性があります。",
    businessImpact: "一部ユーザーの利用を妨げ、Form完了率や情報到達率を下げる可能性があります。",
    recommendation: "目的に合う代替テキスト、明示Label、連続したHeading構造を追加してください。",
    groundedInEvidence: true,
    limitations: "Contrastはrender後のcomputed styleを検証していないためHuman Review対象です。",
  };
  if (/CTA|CONVERSION|NAVIGATION|FORM|CHECKOUT/u.test(code)) return {
    mode: "demo_rule_based",
    meaning: "ユーザーの次の行動や完了条件が伝わりにくい可能性があります。",
    businessImpact: "迷いと離脱を増やし、問い合わせ・購入などのConversionを阻害します。",
    recommendation: "主要行動を1つに絞り、結果が予測できる具体的なLabelと補足を配置してください。",
    groundedInEvidence: true,
  };
  return {
    mode: "demo_rule_based",
    meaning: "決定論的監査で品質上の不整合を検出しました。",
    businessImpact: "表示安定性、発見性、操作性のいずれかへ影響する可能性があります。",
    recommendation: "Evidenceを確認し、影響ページを特定したうえで修正してください。",
    groundedInEvidence: true,
  };
}

function technologyQualifier(page: AuditPageInput): string {
  const names = page.technologyHints.map((hint) => typeof hint === "string" ? hint : hint.name).filter(Boolean);
  return names.length > 0
    ? `Technology Hint: ${names.join(" / ")}。実装前に実際の構成を確認してください。`
    : "対象Technologyを確認できないため、標準HTMLとしての例です。";
}

function suggestedFix(seedValue: FindingSeed, page: AuditPageInput): SuggestedFix {
  const qualifier = technologyQualifier(page);
  if (/TITLE/u.test(seedValue.code)) return {
    field: "Title",
    before: page.metadata.title || "（未設定）",
    suggested: `${page.metadata.h1 || "ページ固有の主題"} | サイト名`,
    codeExample: `<title>${page.metadata.h1 || "ページ固有の主題"} | サイト名</title>`,
    technologyQualifier: qualifier,
  };
  if (/DESCRIPTION/u.test(seedValue.code)) return {
    field: "Meta Description",
    before: page.metadata.description || "（未設定）",
    suggested: "対象ユーザー、提供価値、次の行動を具体的に説明する文へ置き換える",
    codeExample: '<meta name="description" content="ページ固有の価値を120文字前後で説明">',
    technologyQualifier: qualifier,
  };
  if (/CANONICAL/u.test(seedValue.code)) return {
    field: "Canonical",
    before: page.metadata.canonical || "（未設定）",
    suggested: page.finalUrl,
    codeExample: `<link rel="canonical" href="${page.finalUrl}">`,
    technologyQualifier: qualifier,
  };
  if (/H1/u.test(seedValue.code)) return {
    field: "H1",
    before: page.metadata.h1 || `H1 ${page.metadata.h1Count}件`,
    suggested: "ページの主目的を一文で示す固有H1を1件設定",
    codeExample: "<h1>ページ固有の主題</h1>",
    technologyQualifier: qualifier,
  };
  if (/ALT/u.test(seedValue.code)) return {
    field: "Image alt",
    before: `${page.accessibility.missingAltCount}件不足`,
    suggested: "情報画像には目的を表すalt、装飾画像にはalt=\"\"を設定",
    codeExample: '<img src="..." alt="画像が伝える具体的な内容">',
    technologyQualifier: qualifier,
  };
  if (/LABEL|BUTTON/u.test(seedValue.code)) return {
    field: "Accessible Name",
    before: `${page.accessibility.unlabeledControlCount + page.accessibility.emptyButtonCount}件不足`,
    suggested: "表示Labelまたはaria-labelで操作目的を明示",
    codeExample: '<label for="email">メールアドレス</label><input id="email" name="email">',
    technologyQualifier: qualifier,
  };
  if (/BROKEN|STATUS_5/u.test(seedValue.code)) return {
    field: "HTTP / Link",
    before: `HTTP ${page.status ?? "取得失敗"}`,
    suggested: "有効な200 URLへ修正、または1 hopの恒久Redirectを設定",
    technologyQualifier: qualifier,
  };
  return {
    field: seedValue.title,
    before: seedValue.detectedFact,
    suggested: seedValue.suggestedValue || "Evidenceを基に、影響範囲を確認して修正",
    technologyQualifier: qualifier,
  };
}

function createIssue(
  page: AuditPageInput,
  seedValue: FindingSeed,
  interpretationOverrides: Readonly<Record<string, IssueInterpretation>>,
): ImprovementIssue {
  const fingerprint = createIssueFingerprint({ code: seedValue.code, url: page.finalUrl, source: seedValue.source });
  const evidenceFingerprint = createEvidenceFingerprint({
    code: seedValue.code,
    url: page.finalUrl,
    source: seedValue.source,
    detectedFact: seedValue.detectedFact,
  });
  const priority = calculatePriority(derivePriorityFactors({
    code: seedValue.code,
    severity: seedValue.severity,
    category: seedValue.category,
  }));
  return {
    id: fingerprint,
    fingerprint,
    code: seedValue.code,
    category: seedValue.category,
    severity: seedValue.severity,
    title: seedValue.title,
    url: page.finalUrl,
    page: page.metadata.title || page.finalUrl,
    origin: "deterministic",
    evidence: [{
      id: evidenceFingerprint,
      fingerprint: evidenceFingerprint,
      url: page.finalUrl,
      page: page.metadata.title || page.finalUrl,
      detectedFact: seedValue.detectedFact,
      source: seedValue.source,
      locator: seedValue.locator,
      checkedAt: page.checkedAt,
    }],
    priority,
    backlog: mapBacklogBucket({
      code: seedValue.code,
      severity: seedValue.severity,
      category: seedValue.category,
      priority,
    }),
    interpretation: interpretationOverrides[fingerprint] ?? defaultInterpretation(seedValue),
    suggestedFix: suggestedFix(seedValue, page),
    detectedAt: page.checkedAt,
  };
}

function emptyCategorySummary(): Record<IssueCategory, CategorySummary> {
  return {
    technical: { category: "technical", total: 0, high: 0, medium: 0, low: 0 },
    content: { category: "content", total: 0, high: 0, medium: 0, low: 0 },
    ux: { category: "ux", total: 0, high: 0, medium: 0, low: 0 },
    accessibility: { category: "accessibility", total: 0, high: 0, medium: 0, low: 0 },
  };
}

export function synthesizeAudit(
  pages: AuditPageInput[],
  interpretationOverrides: Readonly<Record<string, IssueInterpretation>> = {},
): AuditSynthesis {
  const duplicateFindings = duplicateTitleFindings(pages);
  const issues = pages.flatMap((page) => [
    ...collectPageFindings(page),
    ...(duplicateFindings.get(page.id) ?? []),
  ].map((finding) => createIssue(page, finding, interpretationOverrides)));

  const deduplicated = [...new Map(issues.map((issue) => [issue.fingerprint, issue])).values()]
    .sort((left, right) => right.priority.score - left.priority.score || left.url.localeCompare(right.url));
  const categorySummary = emptyCategorySummary();
  for (const issue of deduplicated) {
    const summary = categorySummary[issue.category];
    summary.total += 1;
    summary[issue.priority.level] += 1;
  }
  const backlog = Object.fromEntries(BACKLOG_BUCKETS.map((bucket) => [
    bucket,
    deduplicated.filter((issue) => issue.backlog === bucket),
  ])) as Record<BacklogBucket, ImprovementIssue[]>;
  return { issues: deduplicated, categorySummary, backlog };
}
