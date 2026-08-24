#!/usr/bin/env node

const APP_NAME = "AI Webサイト改善エージェント";
const REQUEST_TIMEOUT_MS = 15_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function productionBaseUrl(rawValue) {
  if (!rawValue) {
    throw new Error(
      "Usage: npm run verify:production -- https://ai-website-improvement-agent.vercel.app",
    );
  }

  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error("Production URL must be an absolute HTTP(S) URL.");
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("Production URL must use HTTP(S) and must not contain credentials.");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return url;
}

async function request(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: "follow",
      ...init,
      headers: {
        Accept: "application/json, text/html;q=0.9",
        ...init.headers,
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response, label) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label} did not return JSON.`);
  }
}

async function checkAuditBlock(apiUrl, url, expectedKind, expectedCode) {
  const response = await request(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  assert(response.status === 200, `Expected HTTP 200, received ${response.status}.`);
  assert(
    (response.headers.get("cache-control") ?? "").toLowerCase().includes("no-store"),
    "Audit response must use Cache-Control: no-store.",
  );
  const payload = await readJson(response, expectedCode);
  assert(payload && typeof payload === "object", "Audit payload is missing.");
  assert(payload.result?.statusKind === expectedKind, `Expected statusKind ${expectedKind}.`);
  assert(payload.result?.errorCode === expectedCode, `Expected errorCode ${expectedCode}.`);
  assert(payload.result?.statusCode === null, "Blocked/invalid checks must not invent an HTTP status.");
}

async function main() {
  const baseUrl = productionBaseUrl(process.argv[2]);
  const homeUrl = new URL(baseUrl.pathname || "/", baseUrl.origin);
  const apiUrl = new URL("/api/check", baseUrl.origin);
  const results = [];

  // Identify the deployment before sending POST requests. This prevents an
  // accidental invocation against an unrelated URL supplied on the command line.
  const homeResponse = await request(homeUrl, { headers: { Accept: "text/html" } });
  assert(homeResponse.status === 200, `Home returned HTTP ${homeResponse.status}.`);
  const homeHtml = await homeResponse.text();
  assert(homeHtml.includes(APP_NAME), `Home does not contain the expected app name: ${APP_NAME}`);
  assert(
    (homeResponse.headers.get("x-content-type-options") ?? "").toLowerCase() === "nosniff",
    "Home is missing X-Content-Type-Options: nosniff.",
  );
  results.push("PASS Home / deployment identity");

  // These inputs are rejected before an outbound request is made. The verifier
  // never asks the production service to crawl or mutate an external website.
  await checkAuditBlock(apiUrl, "not a valid URL", "failed", "INVALID_URL");
  results.push("PASS Invalid URL is rejected without an invented status");

  await checkAuditBlock(apiUrl, "http://127.0.0.1/", "blocked", "BLOCKED_TARGET");
  results.push("PASS Private IPv4 target is blocked before fetch");

  for (const result of results) console.log(result);
  console.log(`Production verification: ${results.length}/${results.length} passed`);
  console.log(`Verified origin: ${baseUrl.origin}`);
}

main().catch((error) => {
  console.error(`Production verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
