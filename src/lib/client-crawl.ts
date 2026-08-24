import type { SiteAuditResult } from "@/lib/site-audit/types";

export interface CrawlLimits {
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  timeoutMs: number;
  maxToolCalls: number;
  maxRetries: number;
  maxDurationMs: number;
}

export interface CrawlProgress {
  phase: "crawl" | "check";
  checked: number;
  discovered: number;
  currentUrl: string;
  depth: number;
  toolCalls: number;
}

export interface CrawlOutput {
  pages: Array<SiteAuditResult & { depth: number; sourcePage?: string }>;
  toolCalls: number;
  retries: number;
  stoppedBy: "complete" | "max_pages" | "max_tool_calls" | "max_duration" | "cancelled";
}

export type AuditCheck = (
  url: string,
  context: { depth: number; sourcePage?: string; timeoutMs: number; signal: AbortSignal },
) => Promise<SiteAuditResult>;

interface QueueItem {
  url: string;
  depth: number;
  sourcePage?: string;
}

export const DEFAULT_CRAWL_LIMITS: CrawlLimits = Object.freeze({
  maxPages: 20,
  maxDepth: 2,
  concurrency: 3,
  timeoutMs: 8_000,
  maxToolCalls: 36,
  maxRetries: 1,
  maxDurationMs: 90_000,
});

export function clampCrawlLimits(input: Partial<CrawlLimits>): CrawlLimits {
  const integer = (value: number | undefined, fallback: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.trunc(Number.isFinite(value) ? value as number : fallback)));
  return {
    maxPages: integer(input.maxPages, DEFAULT_CRAWL_LIMITS.maxPages, 1, 50),
    maxDepth: integer(input.maxDepth, DEFAULT_CRAWL_LIMITS.maxDepth, 0, 3),
    concurrency: integer(input.concurrency, DEFAULT_CRAWL_LIMITS.concurrency, 1, 4),
    timeoutMs: integer(input.timeoutMs, DEFAULT_CRAWL_LIMITS.timeoutMs, 2_000, 15_000),
    maxToolCalls: integer(input.maxToolCalls, DEFAULT_CRAWL_LIMITS.maxToolCalls, 1, 80),
    maxRetries: integer(input.maxRetries, DEFAULT_CRAWL_LIMITS.maxRetries, 0, 2),
    maxDurationMs: integer(input.maxDurationMs, DEFAULT_CRAWL_LIMITS.maxDurationMs, 10_000, 180_000),
  };
}

export function normalizeCrawlUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sameOrigin(raw: string, origin: string): boolean {
  try {
    return new URL(raw).origin === origin;
  } catch {
    return false;
  }
}

function mergeSignals(parent: AbortSignal, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);
  if (parent.aborted) controller.abort();
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parent.removeEventListener("abort", abort);
    },
  };
}

export async function crawlSite(options: {
  seedUrl: string;
  limits?: Partial<CrawlLimits>;
  check: AuditCheck;
  signal?: AbortSignal;
  onProgress?: (progress: CrawlProgress) => void;
  now?: () => number;
}): Promise<CrawlOutput> {
  const limits = clampCrawlLimits(options.limits ?? {});
  const seed = normalizeCrawlUrl(options.seedUrl);
  if (!seed) throw new TypeError("有効なHTTP(S) URLを入力してください。");
  const runController = new AbortController();
  const externalSignal = options.signal;
  const abortRun = () => runController.abort();
  externalSignal?.addEventListener("abort", abortRun, { once: true });
  if (externalSignal?.aborted) runController.abort();
  const now = options.now ?? Date.now;
  const startedAt = now();
  const pages: CrawlOutput["pages"] = [];
  const visited = new Set<string>([seed]);
  let frontier: QueueItem[] = [{ url: seed, depth: 0 }];
  let toolCalls = 0;
  let retries = 0;
  let baseOrigin: string | null = null;
  let stoppedBy: CrawlOutput["stoppedBy"] = "complete";

  const durationExceeded = () => now() - startedAt >= limits.maxDurationMs;

  try {
    while (frontier.length > 0) {
      if (runController.signal.aborted) {
        stoppedBy = "cancelled";
        break;
      }
      if (durationExceeded()) {
        stoppedBy = "max_duration";
        break;
      }
      if (pages.length >= limits.maxPages) {
        stoppedBy = "max_pages";
        break;
      }
      if (toolCalls >= limits.maxToolCalls) {
        stoppedBy = "max_tool_calls";
        break;
      }

      const room = Math.min(
        limits.maxPages - pages.length,
        limits.maxToolCalls - toolCalls,
      );
      const current = frontier.slice(0, room);
      frontier = [];
      const ordered = new Array<(SiteAuditResult & { depth: number; sourcePage?: string }) | null>(current.length).fill(null);
      let cursor = 0;

      const worker = async () => {
        while (!runController.signal.aborted) {
          const index = cursor;
          cursor += 1;
          const item = current[index];
          if (!item || durationExceeded() || toolCalls >= limits.maxToolCalls) return;

          let attempt = 0;
          while (attempt <= limits.maxRetries && !runController.signal.aborted) {
            if (toolCalls >= limits.maxToolCalls || durationExceeded()) return;
            const merged = mergeSignals(runController.signal, limits.timeoutMs);
            toolCalls += 1;
            options.onProgress?.({
              phase: item.depth === 0 ? "crawl" : "check",
              checked: pages.length + ordered.filter(Boolean).length,
              discovered: visited.size,
              currentUrl: item.url,
              depth: item.depth,
              toolCalls,
            });
            try {
              const result = await options.check(item.url, {
                depth: item.depth,
                sourcePage: item.sourcePage,
                timeoutMs: limits.timeoutMs,
                signal: merged.signal,
              });
              ordered[index] = { ...result, depth: item.depth, sourcePage: item.sourcePage };
              merged.cleanup();
              break;
            } catch (error) {
              merged.cleanup();
              if (runController.signal.aborted) return;
              if (attempt >= limits.maxRetries) throw error;
              attempt += 1;
              retries += 1;
            }
          }
        }
      };

      try {
        await Promise.all(Array.from(
          { length: Math.min(limits.concurrency, current.length) },
          () => worker(),
        ));
      } catch (error) {
        runController.abort();
        throw error;
      }

      const levelResults = ordered.filter(
        (result): result is SiteAuditResult & { depth: number; sourcePage?: string } => Boolean(result),
      );
      pages.push(...levelResults);

      if (!baseOrigin && levelResults[0]) {
        try {
          baseOrigin = new URL(levelResults[0].finalUrl).origin;
        } catch {
          baseOrigin = new URL(seed).origin;
        }
      }

      const next: QueueItem[] = [];
      for (const result of levelResults) {
        if (result.depth >= limits.maxDepth || !baseOrigin) continue;
        if (!sameOrigin(result.finalUrl, baseOrigin)) continue;
        for (const link of result.internalLinks) {
          if (pages.length + next.length >= limits.maxPages) break;
          const normalized = normalizeCrawlUrl(link.url);
          if (!normalized || !sameOrigin(normalized, baseOrigin) || visited.has(normalized)) continue;
          visited.add(normalized);
          next.push({ url: normalized, depth: result.depth + 1, sourcePage: result.finalUrl });
        }
      }
      frontier = next;
      options.onProgress?.({
        phase: "check",
        checked: pages.length,
        discovered: visited.size,
        currentUrl: "",
        depth: levelResults.at(-1)?.depth ?? 0,
        toolCalls,
      });
    }

    if (stoppedBy === "complete") {
      if (runController.signal.aborted) stoppedBy = externalSignal?.aborted ? "cancelled" : "complete";
      else if (durationExceeded()) stoppedBy = "max_duration";
      else if (toolCalls >= limits.maxToolCalls && frontier.length > 0) stoppedBy = "max_tool_calls";
      else if (pages.length >= limits.maxPages && frontier.length > 0) stoppedBy = "max_pages";
    }
    return { pages: pages.slice(0, limits.maxPages), toolCalls, retries, stoppedBy };
  } finally {
    externalSignal?.removeEventListener("abort", abortRun);
  }
}

export async function requestSiteAudit(
  url: string,
  context: { sourcePage?: string; signal: AbortSignal },
): Promise<SiteAuditResult> {
  const response = await fetch("/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, sourcePage: context.sourcePage }),
    signal: context.signal,
  });
  const payload = await response.json().catch(() => null) as
    | { result?: SiteAuditResult; error?: string }
    | null;
  if (!response.ok || !payload?.result) {
    throw new Error(payload?.error ?? `監査APIが ${response.status} を返しました。`);
  }
  return payload.result;
}
