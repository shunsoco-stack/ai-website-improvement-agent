import { auditUrl } from "@/lib/site-audit/http-client";
import type { SiteAuditRequest } from "@/lib/site-audit/types";
import { parseTargetUrl } from "@/lib/site-audit/url-policy";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MAX_CONTENT_LENGTH = 16 * 1024;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;
const MAX_RATE_BUCKETS = 1_000;
const MAX_ACTIVE_CHECKS = 6;
const MAX_ACTIVE_PER_ORIGIN = 3;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const activeByOrigin = new Map<string, number>();
let activeChecks = 0;

class RequestBodyTooLargeError extends Error {}

function clientKey(request: Request): string {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anonymous"
  ).slice(0, 128);
}

function allowRequest(request: Request): { allowed: boolean; remaining: number } {
  const now = Date.now();
  if (rateBuckets.size >= MAX_RATE_BUCKETS) {
    for (const [key, bucket] of rateBuckets) {
      if (bucket.resetAt <= now) rateBuckets.delete(key);
    }
  }
  const key = clientKey(request);
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.delete(key);
    while (rateBuckets.size >= MAX_RATE_BUCKETS) {
      const oldest = rateBuckets.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      rateBuckets.delete(oldest);
    }
    rateBuckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - 1 };
  }
  bucket.count += 1;
  rateBuckets.delete(key);
  rateBuckets.set(key, bucket);
  return {
    allowed: bucket.count <= MAX_REQUESTS_PER_WINDOW,
    remaining: Math.max(0, MAX_REQUESTS_PER_WINDOW - bucket.count),
  };
}

async function readBodyWithinLimit(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      size += value.byteLength;
      if (size > MAX_CONTENT_LENGTH) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function json(
  data: unknown,
  status = 200,
  remaining?: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(remaining === undefined ? {} : { "X-RateLimit-Remaining": String(remaining) }),
      ...extraHeaders,
    },
  });
}

function isBody(value: unknown): value is SiteAuditRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.url === "string" &&
    body.url.length > 0 &&
    body.url.length <= 2_048 &&
    (body.sourcePage === undefined ||
      (typeof body.sourcePage === "string" && body.sourcePage.length <= 2_048)) &&
    (body.slowThresholdMs === undefined ||
      (typeof body.slowThresholdMs === "number" && Number.isFinite(body.slowThresholdMs)))
  );
}

function targetOriginKey(rawUrl: string): string {
  try {
    const target = parseTargetUrl(rawUrl);
    return target.origin;
  } catch {
    return "invalid-or-blocked-target";
  }
}

function acquireCheckSlot(origin: string):
  | { acquired: true; release: () => void }
  | { acquired: false; reason: "global" | "origin" } {
  if (activeChecks >= MAX_ACTIVE_CHECKS) return { acquired: false, reason: "global" };
  const originActive = activeByOrigin.get(origin) ?? 0;
  if (originActive >= MAX_ACTIVE_PER_ORIGIN) return { acquired: false, reason: "origin" };

  activeChecks += 1;
  activeByOrigin.set(origin, originActive + 1);
  let released = false;
  return {
    acquired: true,
    release: () => {
      if (released) return;
      released = true;
      activeChecks = Math.max(0, activeChecks - 1);
      const remaining = (activeByOrigin.get(origin) ?? 1) - 1;
      if (remaining <= 0) activeByOrigin.delete(origin);
      else activeByOrigin.set(origin, remaining);
    },
  };
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "Content-Type must be application/json" }, 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CONTENT_LENGTH) {
    return json({ error: "Request body is too large" }, 413);
  }

  const rate = allowRequest(request);
  if (!rate.allowed) {
    return json(
      { error: "Too many checks. Please wait and retry." },
      429,
      rate.remaining,
      { "Retry-After": "60" },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(await readBodyWithinLimit(request));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ error: "Request body is too large" }, 413, rate.remaining);
    }
    return json({ error: "Malformed JSON" }, 400, rate.remaining);
  }
  if (!isBody(body)) {
    return json({ error: "Invalid request payload" }, 400, rate.remaining);
  }

  const auditBody: SiteAuditRequest = {
    url: body.url,
    sourcePage: body.sourcePage,
    slowThresholdMs:
      body.slowThresholdMs === undefined
        ? undefined
        : Math.min(30_000, Math.max(100, Math.trunc(body.slowThresholdMs))),
  };
  const slot = acquireCheckSlot(targetOriginKey(auditBody.url));
  if (!slot.acquired) {
    const sameOrigin = slot.reason === "origin";
    return json(
      {
        error: sameOrigin
          ? "This target already has three active checks. Please retry shortly."
          : "The audit service is busy. Please retry shortly.",
      },
      sameOrigin ? 429 : 503,
      rate.remaining,
      { "Retry-After": "1" },
    );
  }

  try {
    const result = await auditUrl(auditBody);
    return json({ result }, 200, rate.remaining);
  } finally {
    slot.release();
  }
}
