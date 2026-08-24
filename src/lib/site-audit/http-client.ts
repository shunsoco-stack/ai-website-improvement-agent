import "server-only";

import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";

import { extractPageData } from "./html-audit";
import type {
  AccessibilitySignals,
  AuditIssue,
  AuditIssueCategory,
  AuditIssueCode,
  AuditIssueSeverity,
  AuditStatusKind,
  PageMetadata,
  RedirectStep,
  SiteAuditRequest,
  SiteAuditResult,
} from "./types";
import {
  AuditDeadlineError,
  parseTargetUrl,
  resolvePublicTarget,
  TargetPolicyError,
  UrlFormatError,
} from "./url-policy";

const USER_AGENT = "AIWebsiteImprovementAgent/1.0";
export const REQUEST_TIMEOUT_MS = 8_000;
export const AUDIT_DEADLINE_MS = 24_000;
export const MAX_BODY_BYTES = 1_000_000;
export const MAX_REDIRECTS = 6;

const EMPTY_METADATA: PageMetadata = {
  title: "",
  description: "",
  canonical: "",
  h1: "",
  h1Count: 0,
};

export interface OneHopResponse {
  url: string;
  statusCode: number;
  location?: string;
  responseTimeMs: number;
  contentType: string;
  body: string;
  bodyReadable: boolean;
  bodyTruncated: boolean;
}

export interface FollowResponse {
  statusCode: number;
  finalUrl: string;
  chain: RedirectStep[];
  redirectLoop: boolean;
  redirectLimit: boolean;
  responseTimeMs: number;
  contentType: string;
  body: string;
  bodyReadable: boolean;
  bodyTruncated: boolean;
}

export type RequestFactory = (
  options: http.RequestOptions & https.RequestOptions,
  callback: (response: http.IncomingMessage) => void,
) => http.ClientRequest;

export interface OneHopOptions {
  deadlineAt: number;
  signal: AbortSignal;
  maxBodyBytes?: number;
  requestFactory?: RequestFactory;
}

export interface FollowOptions extends OneHopOptions {
  maxRedirects?: number;
  requestHop?: (url: string, options: OneHopOptions) => Promise<OneHopResponse>;
}

export interface AuditUrlDependencies {
  follow?: (url: string, options: FollowOptions) => Promise<FollowResponse>;
}

function isRedirectStatus(statusCode: number): boolean {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

export async function requestOneHop(
  rawUrl: string,
  options: OneHopOptions,
): Promise<OneHopResponse> {
  // Resolving here, rather than once for the whole chain, ensures every
  // redirect destination gets a fresh SSRF policy check. The resulting socket
  // is pinned to the checked address to close the DNS-rebinding window.
  const target = await resolvePublicTarget(rawUrl, {
    deadlineAt: options.deadlineAt,
    signal: options.signal,
  });
  const remainingMs = options.deadlineAt - Date.now();
  if (remainingMs <= 0 || options.signal.aborted) throw new AuditDeadlineError();
  const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, remainingMs);
  const maxBodyBytes = Math.max(1, options.maxBodyBytes ?? MAX_BODY_BYTES);

  return new Promise<OneHopResponse>((resolve, reject) => {
    const startedAt = performance.now();
    const originalHostname = target.url.hostname.replace(/^\[|\]$/g, "");
    const transport = target.url.protocol === "https:" ? https : http;
    const requestFactory = options.requestFactory ?? (transport.request as RequestFactory);
    let settled = false;
    let activeResponse: http.IncomingMessage | undefined;
    const timers: { hard?: ReturnType<typeof setTimeout> } = {};
    const onAbort = () => abortRequest();

    const cleanup = () => {
      if (timers.hard) clearTimeout(timers.hard);
      options.signal.removeEventListener("abort", onAbort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = (result: OneHopResponse) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const request = requestFactory(
      {
        protocol: target.url.protocol,
        hostname: target.address,
        family: target.family,
        port: target.url.port || (target.url.protocol === "https:" ? 443 : 80),
        path: `${target.url.pathname}${target.url.search}`,
        method: "GET",
        agent: false,
        maxHeaderSize: 32 * 1024,
        headers: {
          Host: target.url.host,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Encoding": "identity",
          "User-Agent": USER_AGENT,
          "Cache-Control": "no-cache",
        },
        ...(target.url.protocol === "https:"
          ? { servername: originalHostname, rejectUnauthorized: true }
          : {}),
      },
      (response) => {
        activeResponse = response;
        if (settled) {
          response.destroy();
          return;
        }
        const responseTimeMs = Math.max(1, Math.round(performance.now() - startedAt));
        const statusCode = response.statusCode ?? 0;
        const locationHeader = response.headers.location;
        const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
        const contentTypeHeader = response.headers["content-type"];
        const contentType = Array.isArray(contentTypeHeader)
          ? (contentTypeHeader[0] ?? "")
          : (contentTypeHeader ?? "");

        if (isRedirectStatus(statusCode)) {
          succeed({
            url: target.url.toString(),
            statusCode,
            location,
            responseTimeMs,
            contentType,
            body: "",
            bodyReadable: false,
            bodyTruncated: false,
          });
          response.destroy();
          return;
        }

        const contentEncodingHeader = response.headers["content-encoding"];
        const contentEncoding = Array.isArray(contentEncodingHeader)
          ? contentEncodingHeader[0]
          : contentEncodingHeader;
        if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
          succeed({
            url: target.url.toString(),
            statusCode,
            location,
            responseTimeMs,
            contentType,
            body: "",
            bodyReadable: false,
            bodyTruncated: false,
          });
          response.destroy();
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (buffer.length === 0) return;
          const remaining = maxBodyBytes - size;
          if (remaining <= 0 || buffer.length > remaining) {
            if (remaining > 0) {
              chunks.push(buffer.subarray(0, remaining));
              size += remaining;
            }
            succeed({
              url: target.url.toString(),
              statusCode,
              location,
              responseTimeMs,
              contentType,
              body: Buffer.concat(chunks).toString("utf8"),
              bodyReadable: true,
              bodyTruncated: true,
            });
            response.destroy();
            return;
          }
          chunks.push(buffer);
          size += buffer.length;
        });
        response.on("end", () => {
          if (settled) return;
          succeed({
            url: target.url.toString(),
            statusCode,
            location,
            responseTimeMs,
            contentType,
            body: Buffer.concat(chunks).toString("utf8"),
            bodyReadable: true,
            bodyTruncated: false,
          });
        });
        response.on("error", (error) => fail(error));
        response.on("aborted", () => fail(new Error("Response aborted")));
      },
    );

    request.setTimeout(timeoutMs, () => abortRequest(new Error("Request timeout")));
    request.on("error", (error) => fail(error));

    function abortRequest(error = new AuditDeadlineError()): void {
      if (settled) return;
      settled = true;
      cleanup();
      activeResponse?.destroy(error);
      request.destroy(error);
      reject(error);
    }

    timers.hard = setTimeout(() => abortRequest(), timeoutMs);
    options.signal.addEventListener("abort", onAbort, { once: true });
    if (options.signal.aborted) {
      abortRequest();
      return;
    }
    request.end();
  });
}

export async function followUrl(rawUrl: string, options: FollowOptions): Promise<FollowResponse> {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const requestHop = options.requestHop ?? requestOneHop;
  let currentUrl = rawUrl;
  let finalResponse: OneHopResponse | null = null;
  let redirectLoop = false;
  let redirectLimit = false;
  const chain: RedirectStep[] = [];
  const seen = new Set<string>();

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (options.deadlineAt <= Date.now() || options.signal.aborted) {
      throw new AuditDeadlineError();
    }
    const normalizedUrl = new URL(currentUrl);
    normalizedUrl.hash = "";
    const normalized = normalizedUrl.toString();
    if (seen.has(normalized)) {
      redirectLoop = true;
      break;
    }
    seen.add(normalized);

    const response = await requestHop(normalized, options);
    finalResponse = response;
    chain.push({
      url: response.url,
      statusCode: response.statusCode,
      location: response.location,
      responseTimeMs: response.responseTimeMs,
    });
    if (!isRedirectStatus(response.statusCode) || !response.location) break;

    const nextUrlObject = new URL(response.location, response.url);
    nextUrlObject.hash = "";
    const nextUrl = nextUrlObject.toString();
    if (seen.has(nextUrl)) {
      redirectLoop = true;
      currentUrl = nextUrl;
      break;
    }
    if (hop === maxRedirects) {
      redirectLimit = true;
      break;
    }
    currentUrl = nextUrl;
  }

  if (!finalResponse) throw new Error("No response received");
  return {
    statusCode: finalResponse.statusCode,
    finalUrl: redirectLoop ? currentUrl : finalResponse.url,
    chain,
    redirectLoop,
    redirectLimit,
    responseTimeMs: chain.reduce((sum, step) => sum + step.responseTimeMs, 0),
    contentType: finalResponse.contentType,
    body: finalResponse.body,
    bodyReadable: finalResponse.bodyReadable,
    bodyTruncated: finalResponse.bodyTruncated,
  };
}

function emptyAccessibility(): AccessibilitySignals {
  return {
    imagesChecked: 0,
    missingAltCount: 0,
    controlsChecked: 0,
    unlabeledControlCount: 0,
    headingJumps: [],
    contrast: {
      status: "manual_review",
      reason:
        "CSS・背景画像・状態変化を含む実際の描画結果が必要なため、静的HTML監査ではContrastを断定しません。",
    },
  };
}

function evidencePage(sourcePage: string | undefined, fallback: string): string {
  if (!sourcePage) return fallback;
  try {
    const url = new URL(sourcePage);
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    url.hash = "";
    return url.toString().slice(0, 2_048);
  } catch {
    return fallback;
  }
}

function issue(
  code: AuditIssueCode,
  category: AuditIssueCategory,
  severity: AuditIssueSeverity,
  title: string,
  url: string,
  page: string,
  detectedFact: string,
  source: string,
): AuditIssue {
  const id = createHash("sha256")
    .update([code, url, page, source].join("\u0000"))
    .digest("hex")
    .slice(0, 20);
  return { id, code, category, severity, title, url, page, detectedFact, source };
}

function statusKind(statusCode: number, redirected: boolean): AuditStatusKind {
  if (redirected || (statusCode >= 300 && statusCode < 400)) return "redirect";
  if (statusCode >= 200 && statusCode < 300) return "ok";
  if (statusCode >= 400 && statusCode < 500) return "client_error";
  if (statusCode >= 500) return "server_error";
  return "failed";
}

function errorResult(
  body: SiteAuditRequest,
  code: AuditIssueCode,
  message: string,
  blocked: boolean,
): SiteAuditResult {
  const page = evidencePage(body.sourcePage, body.url);
  return {
    id: randomUUID(),
    inputUrl: body.url,
    finalUrl: body.url,
    statusCode: null,
    statusKind: blocked ? "blocked" : "failed",
    broken: false,
    redirectCount: 0,
    redirectChain: [],
    redirectLoop: false,
    redirectLimit: false,
    responseTimeMs: null,
    contentType: "",
    metadata: { ...EMPTY_METADATA },
    accessibility: emptyAccessibility(),
    contentSnippet: "",
    contentSnippetTruncated: false,
    contentSnippetTrust: "untrusted",
    technologyHints: [],
    internalLinks: [],
    externalLinks: [],
    issues: [
      issue(
        code,
        "technical",
        "high",
        blocked ? "安全Policyにより監査を停止" : "URL監査に失敗",
        body.url,
        page,
        message,
        "Backend URL policy / HTTP client",
      ),
    ],
    bodyReadable: false,
    bodyTruncated: false,
    checkedAt: new Date().toISOString(),
    errorCode: code,
    errorMessage: message,
  };
}

export async function auditUrl(
  body: SiteAuditRequest,
  dependencies: AuditUrlDependencies = {},
): Promise<SiteAuditResult> {
  const slowThresholdMs = Math.min(30_000, Math.max(100, body.slowThresholdMs ?? 2_000));
  const deadlineAt = Date.now() + AUDIT_DEADLINE_MS;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(), AUDIT_DEADLINE_MS);

  try {
    const parsed = parseTargetUrl(body.url.trim());
    const normalizedUrl = parsed.toString();
    const response = await (dependencies.follow ?? followUrl)(normalizedUrl, {
      deadlineAt,
      signal: deadlineController.signal,
      maxRedirects: MAX_REDIRECTS,
    });
    const redirected = response.chain.some((step) => isRedirectStatus(step.statusCode));
    const isHtml =
      response.bodyReadable && /(?:text\/html|application\/xhtml\+xml)/i.test(response.contentType);
    const pageData = isHtml ? extractPageData(response.body, response.finalUrl) : null;
    const metadata = pageData?.metadata ?? { ...EMPTY_METADATA };
    const accessibility = pageData?.accessibility ?? emptyAccessibility();
    const page = evidencePage(body.sourcePage, response.finalUrl);
    const issues: AuditIssue[] = [];
    const broken = response.statusCode === 404 || response.statusCode === 410;

    if (broken) {
      issues.push(
        issue(
          "BROKEN_LINK",
          "technical",
          "high",
          "Broken Link",
          response.finalUrl,
          page,
          `HTTP ${response.statusCode} を返しました。`,
          "HTTP status code",
        ),
      );
    } else if (response.statusCode >= 400 && response.statusCode < 500) {
      issues.push(
        issue(
          "HTTP_CLIENT_ERROR",
          "technical",
          "high",
          "Client Error",
          response.finalUrl,
          page,
          `HTTP ${response.statusCode} を返しました。`,
          "HTTP status code",
        ),
      );
    }
    if (response.statusCode >= 500) {
      issues.push(
        issue(
          "HTTP_SERVER_ERROR",
          "technical",
          "high",
          "Server Error",
          response.finalUrl,
          page,
          `HTTP ${response.statusCode} を返しました。`,
          "HTTP status code",
        ),
      );
    }
    if (response.redirectLoop) {
      issues.push(
        issue(
          "REDIRECT_LOOP",
          "technical",
          "high",
          "Redirect Loop",
          response.finalUrl,
          page,
          "同じURLへ戻るRedirect chainを検出しました。",
          "HTTP Location headers",
        ),
      );
    }
    if (response.redirectLimit) {
      issues.push(
        issue(
          "REDIRECT_LIMIT",
          "technical",
          "medium",
          "Redirect上限超過",
          response.finalUrl,
          page,
          `${MAX_REDIRECTS}回を超えるRedirect chainを停止しました。`,
          "HTTP Location headers",
        ),
      );
    }
    if (response.responseTimeMs >= slowThresholdMs) {
      issues.push(
        issue(
          "SLOW_RESPONSE",
          "ux",
          "medium",
          "Response Timeが閾値を超過",
          response.finalUrl,
          page,
          `${response.responseTimeMs}ms（閾値 ${slowThresholdMs}ms）`,
          "Server-side wall-clock timing",
        ),
      );
    }
    if (response.bodyTruncated) {
      issues.push(
        issue(
          "BODY_TRUNCATED",
          "technical",
          "low",
          "監査Bodyを安全上限で切り詰め",
          response.finalUrl,
          page,
          `${MAX_BODY_BYTES.toLocaleString("en-US")} bytesで読取を停止しました。`,
          "Response body byte limit",
        ),
      );
    }

    // Missing checks are only conclusive for a complete, readable HTML body.
    if (isHtml && !response.bodyTruncated && response.statusCode >= 200 && response.statusCode < 400) {
      if (!metadata.title) {
        issues.push(
          issue(
            "MISSING_TITLE",
            "content",
            "medium",
            "Titleなし",
            response.finalUrl,
            page,
            "<title>要素の有効なTextを確認できませんでした。",
            "HTML <title>",
          ),
        );
      }
      if (!metadata.description) {
        issues.push(
          issue(
            "MISSING_DESCRIPTION",
            "content",
            "low",
            "Meta Descriptionなし",
            response.finalUrl,
            page,
            'meta[name="description"]を確認できませんでした。',
            "HTML meta description",
          ),
        );
      }
      if (!metadata.canonical) {
        issues.push(
          issue(
            "MISSING_CANONICAL",
            "technical",
            "low",
            "Canonicalなし",
            response.finalUrl,
            page,
            'link[rel="canonical"]を確認できませんでした。',
            "HTML canonical link",
          ),
        );
      }
      if (!metadata.h1) {
        issues.push(
          issue(
            "MISSING_H1",
            "content",
            "medium",
            "H1なし",
            response.finalUrl,
            page,
            "Textを持つH1を確認できませんでした。",
            "HTML heading structure",
          ),
        );
      }
    }
    if (metadata.h1Count > 1) {
      issues.push(
        issue(
          "MULTIPLE_H1",
          "accessibility",
          "low",
          "H1が複数",
          response.finalUrl,
          page,
          `H1を${metadata.h1Count}件検出しました。`,
          "HTML heading structure",
        ),
      );
    }
    if (accessibility.missingAltCount > 0) {
      issues.push(
        issue(
          "MISSING_ALT",
          "accessibility",
          "medium",
          "alt属性なしの画像",
          response.finalUrl,
          page,
          `${accessibility.imagesChecked}画像中${accessibility.missingAltCount}件でalt属性がありません。空altは装飾画像の可能性があるため欠落扱いしていません。`,
          "HTML img alt attributes",
        ),
      );
    }
    if (accessibility.unlabeledControlCount > 0) {
      issues.push(
        issue(
          "UNLABELED_CONTROL",
          "accessibility",
          "medium",
          "Labelを確認できないForm Control",
          response.finalUrl,
          page,
          `${accessibility.controlsChecked} Control中${accessibility.unlabeledControlCount}件で静的なAccessible Nameを確認できませんでした。`,
          "HTML label / aria-label / aria-labelledby",
        ),
      );
    }
    if (accessibility.headingJumps.length > 0) {
      const first = accessibility.headingJumps[0];
      issues.push(
        issue(
          "HEADING_JUMP",
          "accessibility",
          "low",
          "Heading Levelの飛び越し",
          response.finalUrl,
          page,
          `H${first.from}からH${first.to}へのJumpを含む${accessibility.headingJumps.length}件を検出しました。`,
          "HTML heading sequence",
        ),
      );
    }

    return {
      id: randomUUID(),
      inputUrl: normalizedUrl,
      finalUrl: response.finalUrl,
      statusCode: response.statusCode,
      statusKind:
        response.redirectLoop || response.redirectLimit
          ? "failed"
          : statusKind(response.statusCode, redirected),
      broken,
      redirectCount: response.chain.filter(
        (step) => isRedirectStatus(step.statusCode) && Boolean(step.location),
      ).length,
      redirectChain: response.chain,
      redirectLoop: response.redirectLoop,
      redirectLimit: response.redirectLimit,
      responseTimeMs: response.responseTimeMs,
      contentType: response.contentType,
      metadata,
      accessibility,
      contentSnippet: pageData?.contentSnippet ?? "",
      contentSnippetTruncated: pageData?.contentSnippetTruncated ?? false,
      contentSnippetTrust: "untrusted",
      technologyHints: pageData?.technologyHints ?? [],
      internalLinks: pageData?.links.filter((link) => link.scope === "internal") ?? [],
      externalLinks: pageData?.links.filter((link) => link.scope === "external") ?? [],
      issues,
      bodyReadable: response.bodyReadable,
      bodyTruncated: response.bodyTruncated,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof UrlFormatError) {
      return errorResult(body, "INVALID_URL", error.message, false);
    }
    if (error instanceof TargetPolicyError) {
      return errorResult(body, "BLOCKED_TARGET", error.message, true);
    }
    if (error instanceof AuditDeadlineError) {
      return errorResult(
        body,
        "REQUEST_FAILED",
        "監査が24秒の安全な処理上限を超えたため停止しました。",
        false,
      );
    }
    return errorResult(
      body,
      "REQUEST_FAILED",
      "接続・TLS・Timeout等によりURLを確認できませんでした。",
      false,
    );
  } finally {
    clearTimeout(deadlineTimer);
  }
}
