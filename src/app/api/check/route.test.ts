// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteAuditResult } from "@/lib/site-audit/types";

const { auditUrlMock } = vi.hoisted(() => ({ auditUrlMock: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/site-audit/http-client", () => ({ auditUrl: auditUrlMock }));

import { dynamic, maxDuration, POST, runtime } from "./route";

const RESULT: SiteAuditResult = {
  id: "result-1",
  inputUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  statusCode: 200,
  statusKind: "ok",
  broken: false,
  redirectCount: 0,
  redirectChain: [],
  redirectLoop: false,
  redirectLimit: false,
  responseTimeMs: 120,
  contentType: "text/html",
  metadata: {
    title: "Example",
    description: "Description",
    canonical: "https://example.com/",
    h1: "Example",
    h1Count: 1,
  },
  accessibility: {
    imagesChecked: 0,
    missingAltCount: 0,
    controlsChecked: 0,
    unlabeledControlCount: 0,
    headingJumps: [],
    contrast: { status: "manual_review", reason: "render required" },
  },
  contentSnippet: "Example",
  contentSnippetTruncated: false,
  contentSnippetTrust: "untrusted",
  technologyHints: [],
  internalLinks: [],
  externalLinks: [],
  issues: [],
  bodyReadable: true,
  bodyTruncated: false,
  checkedAt: "2026-08-25T00:00:00.000Z",
};

let ipCounter = 10;
function request(body: string, headers: Record<string, string> = {}): Request {
  ipCounter += 1;
  return new Request("https://audit.example/api/check", {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Real-IP": `198.51.100.${ipCounter}`,
      ...headers,
    },
  });
}

describe("POST /api/check", () => {
  beforeEach(() => {
    auditUrlMock.mockReset();
    auditUrlMock.mockResolvedValue(RESULT);
  });

  it("uses a bounded Node.js Route Handler", () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(30);
  });

  it("rejects unsupported content types", async () => {
    const response = await POST(
      new Request("https://audit.example/api/check", {
        method: "POST",
        body: "url=https://example.com",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
    expect(response.status).toBe(415);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rejects malformed JSON and invalid payloads", async () => {
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request(JSON.stringify({ url: 42 })))).status).toBe(400);
    expect((await POST(request(JSON.stringify({ url: "https://example.com", slowThresholdMs: Number.NaN })))).status).toBe(400);
    expect(auditUrlMock).not.toHaveBeenCalled();
  });

  it("enforces body bytes without trusting Content-Length", async () => {
    const response = await POST(request(JSON.stringify({ url: "x".repeat(17_000) })));
    expect(response.status).toBe(413);
    expect(auditUrlMock).not.toHaveBeenCalled();
  });

  it("clamps numeric input and returns an uncached result", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          url: "https://example.com/",
          sourcePage: "https://example.com/source",
          slowThresholdMs: 999_999,
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-ratelimit-remaining")).toBeTruthy();
    expect(await response.json()).toEqual({ result: RESULT });
    expect(auditUrlMock).toHaveBeenCalledWith({
      url: "https://example.com/",
      sourcePage: "https://example.com/source",
      slowThresholdMs: 30_000,
    });
  });

  it("fails fast above three concurrent checks for one origin", async () => {
    const releases: Array<() => void> = [];
    auditUrlMock.mockImplementation(
      () =>
        new Promise<SiteAuditResult>((resolve) => {
          releases.push(() => resolve(RESULT));
        }),
    );
    const makeRequest = () =>
      POST(
        request(JSON.stringify({ url: "https://same-origin.example/page" }), {
          "X-Real-IP": "198.51.100.220",
        }),
      );

    const active = [makeRequest(), makeRequest(), makeRequest()];
    await vi.waitFor(() => expect(auditUrlMock).toHaveBeenCalledTimes(3));
    const rejected = await makeRequest();
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBe("1");

    releases.forEach((release) => release());
    await Promise.all(active);
  });

  it("fails fast above six concurrent checks globally", async () => {
    const releases: Array<() => void> = [];
    auditUrlMock.mockImplementation(
      () =>
        new Promise<SiteAuditResult>((resolve) => {
          releases.push(() => resolve(RESULT));
        }),
    );
    const makeRequest = (index: number) =>
      POST(
        request(JSON.stringify({ url: `https://target-${index}.example/page` }), {
          "X-Real-IP": "198.51.100.221",
        }),
      );

    const active = Array.from({ length: 6 }, (_, index) => makeRequest(index));
    await vi.waitFor(() => expect(auditUrlMock).toHaveBeenCalledTimes(6));
    const rejected = await makeRequest(7);
    expect(rejected.status).toBe(503);
    expect(rejected.headers.get("retry-after")).toBe("1");

    releases.forEach((release) => release());
    await Promise.all(active);
  });

  it("rate-limits one client after the fixed window allowance", async () => {
    const headers = { "X-Real-IP": "198.51.100.222" };
    for (let index = 0; index < 120; index += 1) {
      const response = await POST(
        request(JSON.stringify({ url: "https://rate.example/" }), headers),
      );
      expect(response.status).toBe(200);
    }
    const rejected = await POST(
      request(JSON.stringify({ url: "https://rate.example/" }), headers),
    );
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBe("60");
  });
});
