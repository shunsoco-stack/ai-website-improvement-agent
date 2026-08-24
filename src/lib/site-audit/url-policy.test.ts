// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

import {
  AuditDeadlineError,
  isBlockedIpv4,
  isBlockedIpv6,
  isPublicAddress,
  parseTargetUrl,
  resolvePublicTarget,
  TargetPolicyError,
  UrlFormatError,
} from "./url-policy";

describe("site audit URL policy", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    "0.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "168.63.129.16",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
  ])("blocks non-public IPv4 %s", (address) => {
    expect(isBlockedIpv4(address)).toBe(true);
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
    "100::1",
    "2001::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "3fff::1",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "::ffff:8.8.8.8",
  ])("blocks non-public IPv6 %s", (address) => {
    expect(isBlockedIpv6(address)).toBe(true);
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34"])(
    "allows representative public IPv4 %s",
    (address) => expect(isPublicAddress(address)).toBe(true),
  );
  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "allows representative public IPv6 %s",
    (address) => expect(isPublicAddress(address)).toBe(true),
  );

  it.each([
    "https://localhost/",
    "https://localhost./",
    "https://api.localhost/",
    "https://printer/",
    "https://service.local/",
    "https://service.internal/",
    "https://router.home/",
    "https://device.lan/",
    "https://service.corp/",
    "https://metadata.google.internal/",
    "https://metadata.aws.internal/",
    "https://127.0.0.1/",
    "https://10.0.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://[fc00::1]/",
    "https://user:secret@example.com/",
    "https://example.com:3000/",
  ])("rejects unsafe target %s", (rawUrl) => {
    expect(() => parseTargetUrl(rawUrl)).toThrow(TargetPolicyError);
  });

  it.each([
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://127.1/",
  ])("rejects alternate IPv4 spelling %s", (rawUrl) => {
    expect(() => parseTargetUrl(rawUrl)).toThrow(TargetPolicyError);
  });

  it.each(["ftp://example.com/file", "file:///etc/passwd", "gopher://example.com/"])(
    "rejects unsupported protocol %s",
    (rawUrl) => expect(() => parseTargetUrl(rawUrl)).toThrow(UrlFormatError),
  );

  it("normalizes a valid URL and removes the fragment", () => {
    expect(parseTargetUrl("  https://Example.COM/path?q=1#section  ").toString()).toBe(
      "https://example.com/path?q=1",
    );
    expect(() => parseTargetUrl("")).toThrow(UrlFormatError);
    expect(() => parseTargetUrl(`https://example.com/${"x".repeat(2_050)}`)).toThrow(
      UrlFormatError,
    );
  });

  it("requires every DNS answer to be public", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
    await expect(resolvePublicTarget("https://example.com/page")).resolves.toMatchObject({
      address: "93.184.216.34",
      family: 4,
    });

    lookupMock.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ]);
    await expect(resolvePublicTarget("https://mixed.example/")).rejects.toMatchObject({
      code: "BLOCKED_TARGET",
    });
  });

  it("fails closed for empty and failed DNS resolution", async () => {
    lookupMock.mockResolvedValueOnce([]);
    await expect(resolvePublicTarget("https://empty.example/")).rejects.toBeInstanceOf(
      TargetPolicyError,
    );
    lookupMock.mockRejectedValueOnce(new Error("private DNS detail"));
    await expect(resolvePublicTarget("https://failed.example/")).rejects.toMatchObject({
      code: "BLOCKED_TARGET",
      message: "Host名を安全に解決できませんでした。",
    });
  });

  it("does not resolve an already validated public IP literal", async () => {
    await expect(resolvePublicTarget("https://8.8.8.8/")).resolves.toMatchObject({
      address: "8.8.8.8",
      family: 4,
    });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("aborts an in-flight DNS lookup", async () => {
    lookupMock.mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    const pending = resolvePublicTarget("https://slow.example/", {
      deadlineAt: Date.now() + 1_000,
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toBeInstanceOf(AuditDeadlineError);
    controller.abort();
    await rejected;
  });
});
