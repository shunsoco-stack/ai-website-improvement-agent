export type AuditStatusKind =
  | "ok"
  | "redirect"
  | "client_error"
  | "server_error"
  | "blocked"
  | "failed";

export type AuditIssueCategory =
  | "technical"
  | "content"
  | "ux"
  | "accessibility";

export type AuditIssueSeverity = "high" | "medium" | "low";

export type AuditIssueCode =
  | "BROKEN_LINK"
  | "HTTP_CLIENT_ERROR"
  | "HTTP_SERVER_ERROR"
  | "REDIRECT_LOOP"
  | "REDIRECT_LIMIT"
  | "SLOW_RESPONSE"
  | "MISSING_TITLE"
  | "MISSING_DESCRIPTION"
  | "MISSING_CANONICAL"
  | "MISSING_H1"
  | "MULTIPLE_H1"
  | "MISSING_ALT"
  | "UNLABELED_CONTROL"
  | "HEADING_JUMP"
  | "BODY_TRUNCATED"
  | "BLOCKED_TARGET"
  | "INVALID_URL"
  | "REQUEST_FAILED";

export interface AuditIssue {
  id: string;
  code: AuditIssueCode;
  category: AuditIssueCategory;
  severity: AuditIssueSeverity;
  title: string;
  url: string;
  page: string;
  detectedFact: string;
  source: string;
}

export interface RedirectStep {
  url: string;
  statusCode: number;
  location?: string;
  responseTimeMs: number;
}

export interface PageMetadata {
  title: string;
  description: string;
  canonical: string;
  h1: string;
  h1Count: number;
}

export interface HeadingJump {
  from: number;
  to: number;
  text: string;
}

export interface AccessibilitySignals {
  imagesChecked: number;
  missingAltCount: number;
  controlsChecked: number;
  unlabeledControlCount: number;
  headingJumps: HeadingJump[];
  contrast: {
    status: "manual_review";
    reason: string;
  };
}

export interface TechnologyHint {
  name: string;
  confidence: "high" | "medium" | "low";
  evidence: string;
}

export interface DiscoveredLink {
  url: string;
  scope: "internal" | "external";
  text: string;
}

export interface SiteAuditRequest {
  url: string;
  sourcePage?: string;
  slowThresholdMs?: number;
}

export interface SiteAuditResult {
  id: string;
  inputUrl: string;
  finalUrl: string;
  statusCode: number | null;
  statusKind: AuditStatusKind;
  broken: boolean;
  redirectCount: number;
  redirectChain: RedirectStep[];
  redirectLoop: boolean;
  redirectLimit: boolean;
  responseTimeMs: number | null;
  contentType: string;
  metadata: PageMetadata;
  accessibility: AccessibilitySignals;
  contentSnippet: string;
  contentSnippetTruncated: boolean;
  /** Web本文はAgent instructionとして扱わないこと。Backend results always set this. */
  contentSnippetTrust?: "untrusted";
  technologyHints: TechnologyHint[];
  internalLinks: DiscoveredLink[];
  externalLinks: DiscoveredLink[];
  issues: AuditIssue[];
  bodyReadable: boolean;
  bodyTruncated: boolean;
  checkedAt: string;
  errorCode?: AuditIssueCode;
  errorMessage?: string;
}

export interface ParsedPageData {
  metadata: PageMetadata;
  accessibility: AccessibilitySignals;
  contentSnippet: string;
  contentSnippetTruncated: boolean;
  contentSnippetTrust: "untrusted";
  technologyHints: TechnologyHint[];
  links: DiscoveredLink[];
}
