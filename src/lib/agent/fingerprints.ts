const TRACKING_QUERY_PATTERN = /^(?:utm_.+|fbclid|gclid|yclid|ref)$/iu;

export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

export function normalizeAuditUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_QUERY_PATTERN.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString();
}

export function createIssueFingerprint(input: {
  code: string;
  url: string;
  source: string;
}): string {
  const identity = [
    normalizeText(input.code),
    normalizeAuditUrl(input.url),
    normalizeText(input.source),
  ].join("|");
  return `issue-${stableHash(identity)}`;
}

export function createEvidenceFingerprint(input: {
  code: string;
  url: string;
  source: string;
  detectedFact: string;
}): string {
  const issue = createIssueFingerprint(input);
  return `evidence-${stableHash(`${issue}|${normalizeText(input.detectedFact)}`)}`;
}

export function createReinvestigationFingerprint(input: {
  triggerCode: string;
  pattern: string;
  relatedUrls: readonly string[];
}): string {
  const urls = [...new Set(input.relatedUrls.map(normalizeAuditUrl))].sort();
  return `recheck-${stableHash([
    normalizeText(input.triggerCode),
    normalizeText(input.pattern),
    urls.join(","),
  ].join("|"))}`;
}
