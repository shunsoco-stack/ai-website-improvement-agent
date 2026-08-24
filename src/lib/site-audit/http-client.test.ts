// @vitest-environment node

import { EventEmitter } from "node:events";
import type http from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

import {
  auditUrl,
  followUrl,
  requestOneHop,
  type OneHopResponse,
  type RequestFactory,
} from "./http-client";
import { AuditDeadlineError, TargetPolicyError } from "./url-policy";

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
  destroyed = false;
  onDestroy?: () => void;

  destroy(): this {
    this.destroyed = true;
    this.onDestroy?.();
    return this;
  }
}

class FakeRequest extends EventEmitter {
  destroyed = false;

  constructor(private readonly onEnd: () => void) {
    super();
  }

  setTimeout(): this {
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }

  end(): this {
    queueMicrotask(this.onEnd);
    return this;
  }
}

function fakeFactory(
  response: FakeResponse,
  startBody: (response: FakeResponse) => void,
  capture?: (options: http.RequestOptions) => void,
): { factory: RequestFactory; request: FakeRequest } {
  let responseCallback: ((response: http.IncomingMessage) => void) | undefined;
  const request = new FakeRequest(() => {
    responseCallback?.(response as unknown as http.IncomingMessage);
    startBody(response);
  });
  const factory: RequestFactory = (options, callback) => {
    capture?.(options);
    responseCallback = callback;
    return request as unknown as http.ClientRequest;
  };
  return { factory, request };
}

describe("pinned HTTP client", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("pins the checked DNS address while preserving Host and TLS SNI", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const response = new FakeResponse();
    let captured: http.RequestOptions | undefined;
    const { factory } = fakeFactory(
      response,
      (stream) => {
        stream.emit("data", Buffer.from("<title>Example</title>"));
        stream.emit("end");
      },
      (options) => {
        captured = options;
      },
    );

    const result = await requestOneHop("https://example.com/path?q=1", {
      deadlineAt: Date.now() + 1_000,
      signal: new AbortController().signal,
      requestFactory: factory,
    });

    expect(result.statusCode).toBe(200);
    expect(captured).toMatchObject({
      hostname: "93.184.216.34",
      family: 4,
      path: "/path?q=1",
      servername: "example.com",
      rejectUnauthorized: true,
      agent: false,
    });
    expect(captured?.headers).toMatchObject({
      Host: "example.com",
      "Accept-Encoding": "identity",
    });
    expect(captured?.headers).not.toHaveProperty("Cookie");
    expect(captured?.headers).not.toHaveProperty("Authorization");
  });

  it("blocks a redirect to metadata IP before issuing the second request", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const response = new FakeResponse();
    response.statusCode = 302;
    response.headers = {
      location: "http://169.254.169.254/latest/meta-data/",
      "content-type": "text/html",
    };
    let requestCount = 0;
    const { factory } = fakeFactory(response, () => undefined, () => {
      requestCount += 1;
    });

    await expect(
      followUrl("https://example.com/start", {
        deadlineAt: Date.now() + 1_000,
        signal: new AbortController().signal,
        requestFactory: factory,
      }),
    ).rejects.toBeInstanceOf(TargetPolicyError);
    expect(requestCount).toBe(1);
  });

  it("caps response bytes and destroys the remaining stream", async () => {
    const response = new FakeResponse();
    const { factory } = fakeFactory(response, (stream) => {
      stream.emit("data", Buffer.from("123456789012345"));
      stream.emit("end");
    });
    const result = await requestOneHop("http://8.8.8.8/", {
      deadlineAt: Date.now() + 1_000,
      signal: new AbortController().signal,
      requestFactory: factory,
      maxBodyBytes: 10,
    });
    expect(result.body).toBe("1234567890");
    expect(result.bodyTruncated).toBe(true);
    expect(response.destroyed).toBe(true);
  });

  it("does not decompress an unexpectedly encoded response", async () => {
    const response = new FakeResponse();
    response.headers = { "content-type": "text/html", "content-encoding": "gzip" };
    const { factory } = fakeFactory(response, () => undefined);
    const result = await requestOneHop("http://8.8.8.8/", {
      deadlineAt: Date.now() + 1_000,
      signal: new AbortController().signal,
      requestFactory: factory,
    });
    expect(result.bodyReadable).toBe(false);
    expect(result.body).toBe("");
    expect(response.destroyed).toBe(true);
  });

  it("kills a slow trickle at the hard wall-clock deadline", async () => {
    vi.useFakeTimers();
    const response = new FakeResponse();
    let interval: ReturnType<typeof setInterval> | undefined;
    const { factory, request } = fakeFactory(response, (stream) => {
      interval = setInterval(() => stream.emit("data", Buffer.from("x")), 20);
      stream.onDestroy = () => {
        if (interval) clearInterval(interval);
      };
    });
    const pending = requestOneHop("http://8.8.8.8/", {
      deadlineAt: Date.now() + 100,
      signal: new AbortController().signal,
      requestFactory: factory,
    });
    const rejected = expect(pending).rejects.toBeInstanceOf(AuditDeadlineError);
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(request.destroyed).toBe(true);
    expect(response.destroyed).toBe(true);
  });

  it("detects redirect loops and redirect limits deterministically", async () => {
    const loopHop = vi.fn(async (url: string): Promise<OneHopResponse> => ({
      url,
      statusCode: 302,
      location: url.endsWith("/a") ? "/b" : "/a",
      responseTimeMs: 1,
      contentType: "text/html",
      body: "",
      bodyReadable: false,
      bodyTruncated: false,
    }));
    const loop = await followUrl("https://example.com/a", {
      deadlineAt: Date.now() + 1_000,
      signal: new AbortController().signal,
      requestHop: loopHop,
    });
    expect(loop.redirectLoop).toBe(true);
    expect(loopHop).toHaveBeenCalledTimes(2);

    const endlessHop = vi.fn(async (url: string): Promise<OneHopResponse> => ({
      url,
      statusCode: 302,
      location: `${url}${url.includes("?") ? "x" : "?x"}`,
      responseTimeMs: 1,
      contentType: "text/html",
      body: "",
      bodyReadable: false,
      bodyTruncated: false,
    }));
    const limited = await followUrl("https://example.com/start", {
      deadlineAt: Date.now() + 1_000,
      signal: new AbortController().signal,
      requestHop: endlessHop,
      maxRedirects: 2,
    });
    expect(limited.redirectLimit).toBe(true);
    expect(endlessHop).toHaveBeenCalledTimes(3);
  });

  it("builds evidence-backed deterministic audit results", async () => {
    const follow = vi.fn(async () => ({
      statusCode: 200,
      finalUrl: "https://example.com/final",
      chain: [
        {
          url: "https://example.com/final",
          statusCode: 200,
          responseTimeMs: 2_500,
        },
      ],
      redirectLoop: false,
      redirectLimit: false,
      responseTimeMs: 2_500,
      contentType: "text/html; charset=utf-8",
      body: `
        <html><head>
          <title>Account</title>
          <meta name="description" content="Manage your account">
          <meta name="generator" content="WordPress">
          <link rel="canonical" href="/final">
        </head><body>
          <h1>Account</h1><h3>Profile</h3>
          <img src="profile.jpg">
          <input placeholder="Email">
        </body></html>
      `,
      bodyReadable: true,
      bodyTruncated: false,
    }));

    const result = await auditUrl(
      {
        url: "https://example.com/start",
        sourcePage: "https://example.com/source",
        slowThresholdMs: 2_000,
      },
      { follow },
    );

    expect(result).toMatchObject({
      finalUrl: "https://example.com/final",
      statusCode: 200,
      statusKind: "ok",
      responseTimeMs: 2_500,
      metadata: {
        title: "Account",
        description: "Manage your account",
        canonical: "https://example.com/final",
        h1: "Account",
        h1Count: 1,
      },
      accessibility: {
        imagesChecked: 1,
        missingAltCount: 1,
        controlsChecked: 1,
        unlabeledControlCount: 1,
      },
      contentSnippetTrust: "untrusted",
    });
    expect(result.technologyHints).toContainEqual(
      expect.objectContaining({ name: "WordPress" }),
    );
    expect(result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "SLOW_RESPONSE",
        "MISSING_ALT",
        "UNLABELED_CONTROL",
        "HEADING_JUMP",
      ]),
    );
    expect(result.issues.every((item) => item.page === "https://example.com/source")).toBe(true);
    expect(result.issues.every((item) => item.detectedFact && item.source)).toBe(true);
  });

  it("classifies 404 and 410 as broken without inventing metadata findings", async () => {
    const follow = vi.fn(async () => ({
      statusCode: 404,
      finalUrl: "https://example.com/missing",
      chain: [
        {
          url: "https://example.com/missing",
          statusCode: 404,
          responseTimeMs: 10,
        },
      ],
      redirectLoop: false,
      redirectLimit: false,
      responseTimeMs: 10,
      contentType: "text/html",
      body: "<html><title>Not found</title></html>",
      bodyReadable: true,
      bodyTruncated: false,
    }));
    const result = await auditUrl({ url: "https://example.com/missing" }, { follow });
    expect(result).toMatchObject({ broken: true, statusCode: 404, statusKind: "client_error" });
    expect(result.issues.map((item) => item.code)).toEqual(["BROKEN_LINK"]);
  });

  it("returns a safe structured result for blocked and malformed targets", async () => {
    const blocked = await auditUrl({ url: "http://127.0.0.1/admin" });
    expect(blocked).toMatchObject({
      statusKind: "blocked",
      errorCode: "BLOCKED_TARGET",
      statusCode: null,
    });
    expect(blocked.issues[0]).toMatchObject({
      code: "BLOCKED_TARGET",
      source: "Backend URL policy / HTTP client",
    });

    const malformed = await auditUrl({ url: "not a URL" });
    expect(malformed).toMatchObject({ statusKind: "failed", errorCode: "INVALID_URL" });
  });
});
