import type {
  AccessibilitySignals,
  DiscoveredLink,
  HeadingJump,
  ParsedPageData,
  TechnologyHint,
} from "./types";

const SPACE_RE = /\s+/g;
const ATTRIBUTE_RE = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/g;
const MAX_URL_LENGTH = 2_048;
const MAX_SNIPPET_LENGTH = 4_000;
const SKIP_CONTENT_TAGS = new Set(["script", "style", "noscript", "template", "svg"]);

interface ScannedTag {
  closing: boolean;
  end: number;
  name: string;
  start: number;
}

interface OpenElement {
  attributes: Record<string, string>;
  contentStart: number;
}

interface OpenHeading {
  contentStart: number;
  level: number;
}

interface ControlCandidate {
  id: string;
  hasAccessibleName: boolean;
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x?[\da-f]+|amp|lt|gt|quot|apos|nbsp);/gi,
    (entity, token: string) => {
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
      };
      const lower = token.toLowerCase();
      if (named[lower]) return named[lower];
      const radix = lower.startsWith("#x") ? 16 : 10;
      const raw = lower.replace(/^#x?/, "");
      const codePoint = Number.parseInt(raw, radix);
      if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) return entity;
      return String.fromCodePoint(codePoint);
    },
  );
}

function isAsciiNameCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    character === ":" ||
    character === "-"
  );
}

function findTagEnd(html: string, from: number): number {
  let quote = "";
  for (let index = from; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index;
  }
  return -1;
}

function scanTagAt(html: string, start: number): ScannedTag | null {
  let cursor = start + 1;
  let closing = false;
  if (html[cursor] === "/") {
    closing = true;
    cursor += 1;
  }
  const nameStart = cursor;
  while (cursor < html.length && isAsciiNameCharacter(html[cursor])) cursor += 1;
  if (cursor === nameStart) return null;
  return {
    closing,
    end: findTagEnd(html, cursor),
    name: html.slice(nameStart, cursor).toLowerCase(),
    start,
  };
}

function matchesAsciiCaseInsensitive(value: string, position: number, expected: string): boolean {
  if (position + expected.length > value.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    const actual = value.charCodeAt(position + index);
    const folded = actual >= 65 && actual <= 90 ? actual + 32 : actual;
    if (folded !== expected.charCodeAt(index)) return false;
  }
  return true;
}

function findRawTextClosingTag(html: string, name: string, from: number): ScannedTag | null {
  let cursor = from;
  while (cursor < html.length) {
    const start = html.indexOf("</", cursor);
    if (start === -1) return null;
    const nameStart = start + 2;
    const boundary = html[nameStart + name.length] ?? "";
    if (
      matchesAsciiCaseInsensitive(html, nameStart, name) &&
      (!boundary || !isAsciiNameCharacter(boundary))
    ) {
      const end = findTagEnd(html, nameStart + name.length);
      if (end === -1) return null;
      return { closing: true, end, name, start };
    }
    cursor = nameStart;
  }
  return null;
}

function stripMarkup(value: string): string {
  const pieces: string[] = [];
  let cursor = 0;
  let textStart = 0;

  while (cursor < value.length) {
    const tagStart = value.indexOf("<", cursor);
    if (tagStart === -1) break;

    if (value.startsWith("<!--", tagStart)) {
      pieces.push(value.slice(textStart, tagStart));
      const commentEnd = value.indexOf("-->", tagStart + 4);
      if (commentEnd === -1) {
        textStart = value.length;
        break;
      }
      cursor = commentEnd + 3;
      textStart = cursor;
      continue;
    }

    const tag = scanTagAt(value, tagStart);
    if (!tag) {
      cursor = tagStart + 1;
      continue;
    }
    if (tag.end === -1) break;

    pieces.push(value.slice(textStart, tagStart));
    cursor = tag.end + 1;
    textStart = cursor;
    if (!tag.closing && SKIP_CONTENT_TAGS.has(tag.name)) {
      const closingTag = findRawTextClosingTag(value, tag.name, cursor);
      if (!closingTag) {
        textStart = value.length;
        break;
      }
      cursor = closingTag.end + 1;
      textStart = cursor;
    }
  }

  pieces.push(value.slice(textStart));
  return pieces.join(" ");
}

function cleanText(value: string | undefined, maxLength: number): string {
  if (!value) return "";
  return decodeEntities(stripMarkup(value)).replace(SPACE_RE, " ").trim().slice(0, maxLength);
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  let match: RegExpExecArray | null;
  ATTRIBUTE_RE.lastIndex = 0;
  while ((match = ATTRIBUTE_RE.exec(tag))) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function resolveHttpUrl(value: string, baseUrl: string): string {
  if (!value || value.length > MAX_URL_LENGTH) return "";
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    url.hash = "";
    const resolved = url.toString();
    return resolved.length <= MAX_URL_LENGTH ? resolved : "";
  } catch {
    return "";
  }
}

function accessibleAttribute(attrs: Record<string, string>): boolean {
  return Boolean(
    attrs["aria-label"]?.trim() ||
      attrs["aria-labelledby"]?.trim() ||
      attrs.title?.trim(),
  );
}

function detectTechnologyHints(html: string, generator: string): TechnologyHint[] {
  const hints: TechnologyHint[] = [];
  const seen = new Set<string>();
  const add = (hint: TechnologyHint) => {
    if (seen.has(hint.name)) return;
    seen.add(hint.name);
    hints.push(hint);
  };

  if (/__NEXT_DATA__|\/_next\/(?:static|image)\b/i.test(html)) {
    add({ name: "Next.js", confidence: "high", evidence: "__NEXT_DATA__ / _next asset" });
  }
  if (/\b(?:data-reactroot|data-reactid)\b/i.test(html)) {
    add({ name: "React", confidence: "medium", evidence: "React DOM marker" });
  }
  if (/\bwp-(?:content|includes)\b/i.test(html) || /wordpress/i.test(generator)) {
    add({ name: "WordPress", confidence: "high", evidence: "wp-content / generator metadata" });
  }
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(html) || /shopify/i.test(generator)) {
    add({ name: "Shopify", confidence: "high", evidence: "Shopify asset / generator marker" });
  }
  if (/__NUXT__|\/_nuxt\//i.test(html)) {
    add({ name: "Nuxt", confidence: "high", evidence: "Nuxt runtime / asset marker" });
  } else if (/\bdata-v-[\da-f]+\b/i.test(html)) {
    add({ name: "Vue", confidence: "medium", evidence: "Vue scoped-style marker" });
  }
  if (/\bng-version\s*=/i.test(html)) {
    add({ name: "Angular", confidence: "high", evidence: "ng-version attribute" });
  }
  if (/wixstatic\.com/i.test(html) || /wix/i.test(generator)) {
    add({ name: "Wix", confidence: "high", evidence: "Wix asset / generator marker" });
  }
  if (/static1\.squarespace\.com/i.test(html) || /squarespace/i.test(generator)) {
    add({ name: "Squarespace", confidence: "high", evidence: "Squarespace asset / generator marker" });
  }
  return hints.slice(0, 8);
}

export function extractPageData(
  html: string,
  pageUrl: string,
  linkLimit = 250,
): ParsedPageData {
  let title = "";
  let titleFound = false;
  let openTitle: number | undefined;
  let description = "";
  let descriptionFound = false;
  let canonical = "";
  let canonicalFound = false;
  let generator = "";
  let h1 = "";
  let h1Count = 0;
  let openHeading: OpenHeading | undefined;
  let previousHeadingLevel: number | undefined;
  let openAnchor: OpenElement | undefined;
  let openButton: { contentStart: number; controlIndex: number } | undefined;
  let labelDepth = 0;

  const explicitLabelIds = new Set<string>();
  const controls: ControlCandidate[] = [];
  const headingJumps: HeadingJump[] = [];
  const links: DiscoveredLink[] = [];
  const seenLinks = new Set<string>();
  const pageOrigin = new URL(pageUrl).origin;
  let imagesChecked = 0;
  let missingAltCount = 0;
  let cursor = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart === -1) break;
    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      if (commentEnd === -1) break;
      cursor = commentEnd + 3;
      continue;
    }

    const tag = scanTagAt(html, tagStart);
    if (!tag) {
      cursor = tagStart + 1;
      continue;
    }
    if (tag.end === -1) break;
    cursor = tag.end + 1;

    if (!tag.closing && SKIP_CONTENT_TAGS.has(tag.name)) {
      const closingTag = findRawTextClosingTag(html, tag.name, cursor);
      if (!closingTag) break;
      cursor = closingTag.end + 1;
      continue;
    }

    if (tag.closing) {
      if (tag.name === "title" && openTitle !== undefined) {
        title = cleanText(html.slice(openTitle, tag.start), 300);
        titleFound = true;
        openTitle = undefined;
      } else if (/^h[1-6]$/.test(tag.name) && openHeading) {
        const text = cleanText(html.slice(openHeading.contentStart, tag.start), 300);
        const level = openHeading.level;
        if (level === 1) {
          if (h1Count === 0) h1 = text;
          h1Count += 1;
        }
        if (previousHeadingLevel !== undefined && level > previousHeadingLevel + 1) {
          headingJumps.push({ from: previousHeadingLevel, to: level, text });
        }
        previousHeadingLevel = level;
        openHeading = undefined;
      } else if (tag.name === "a" && openAnchor) {
        if (links.length < linkLimit) {
          const relations = (openAnchor.attributes.rel ?? "").toLowerCase().split(SPACE_RE);
          const url = resolveHttpUrl(openAnchor.attributes.href ?? "", pageUrl);
          if (!relations.includes("nofollow") && url && !seenLinks.has(url)) {
            seenLinks.add(url);
            links.push({
              url,
              scope: new URL(url).origin === pageOrigin ? "internal" : "external",
              text: cleanText(html.slice(openAnchor.contentStart, tag.start), 160),
            });
          }
        }
        openAnchor = undefined;
      } else if (tag.name === "button" && openButton) {
        const text = cleanText(html.slice(openButton.contentStart, tag.start), 160);
        if (text) controls[openButton.controlIndex].hasAccessibleName = true;
        openButton = undefined;
      } else if (tag.name === "label") {
        labelDepth = Math.max(0, labelDepth - 1);
      }
      continue;
    }

    const attrs = attributes(html.slice(tag.start, tag.end + 1));
    if (tag.name === "title" && !titleFound && openTitle === undefined) {
      openTitle = tag.end + 1;
    } else if (/^h[1-6]$/.test(tag.name) && openHeading === undefined) {
      openHeading = { contentStart: tag.end + 1, level: Number(tag.name.slice(1)) };
    } else if (tag.name === "meta") {
      const name = (attrs.name ?? "").toLowerCase();
      if (name === "description" && !descriptionFound) {
        description = cleanText(attrs.content, 500);
        descriptionFound = true;
      } else if (name === "generator" && !generator) {
        generator = cleanText(attrs.content, 160);
      }
    } else if (tag.name === "link" && !canonicalFound) {
      const relations = (attrs.rel ?? "").toLowerCase().split(SPACE_RE);
      if (relations.includes("canonical")) {
        canonical = resolveHttpUrl(attrs.href ?? "", pageUrl);
        canonicalFound = true;
      }
    } else if (tag.name === "a" && openAnchor === undefined && links.length < linkLimit) {
      openAnchor = { attributes: attrs, contentStart: tag.end + 1 };
    }

    if (tag.name === "img") {
      imagesChecked += 1;
      if (!Object.prototype.hasOwnProperty.call(attrs, "alt")) missingAltCount += 1;
    } else if (tag.name === "label") {
      labelDepth += 1;
      if (attrs.for?.trim()) explicitLabelIds.add(attrs.for.trim());
    } else if (["input", "select", "textarea", "button"].includes(tag.name)) {
      const type = (attrs.type ?? "text").toLowerCase();
      if (tag.name !== "input" || type !== "hidden") {
        const intrinsicInputName =
          tag.name === "input" &&
          (["button", "submit", "reset"].includes(type)
            ? Boolean(attrs.value?.trim())
            : type === "image"
              ? Boolean(attrs.alt?.trim())
              : false);
        const controlIndex = controls.push({
          id: attrs.id?.trim() ?? "",
          hasAccessibleName:
            labelDepth > 0 || accessibleAttribute(attrs) || intrinsicInputName,
        }) - 1;
        if (tag.name === "button") {
          openButton = { contentStart: tag.end + 1, controlIndex };
        }
      }
    }
  }

  const unlabeledControlCount = controls.filter(
    (control) => !control.hasAccessibleName && (!control.id || !explicitLabelIds.has(control.id)),
  ).length;
  const preview = cleanText(html, MAX_SNIPPET_LENGTH + 1);
  const accessibility: AccessibilitySignals = {
    imagesChecked,
    missingAltCount,
    controlsChecked: controls.length,
    unlabeledControlCount,
    headingJumps: headingJumps.slice(0, 25),
    contrast: {
      status: "manual_review",
      reason:
        "CSS・背景画像・状態変化を含む実際の描画結果が必要なため、静的HTML監査ではContrastを断定しません。",
    },
  };

  return {
    metadata: { title, description, canonical, h1, h1Count },
    accessibility,
    contentSnippet: preview.slice(0, MAX_SNIPPET_LENGTH),
    contentSnippetTruncated: preview.length > MAX_SNIPPET_LENGTH,
    contentSnippetTrust: "untrusted",
    technologyHints: detectTechnologyHints(html, generator),
    links,
  };
}

export function normalizeTitle(title: string): string {
  return title.toLocaleLowerCase("ja-JP").replace(SPACE_RE, " ").trim();
}
