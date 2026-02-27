import {
  transformerMetaHighlight,
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from "@shikijs/transformers";
import katex from "katex";
import {
  blockRegex,
  compiler,
  parseCaptureInline,
  Priority,
  sanitizeUrl,
  simpleInlineRegex,
} from "markdown-to-jsx";
import type { MarkdownToJSX } from "markdown-to-jsx";
import type { HighlighterCore } from "shiki";
import { bundledLanguages, getSingletonHighlighter } from "shiki";

const ALERT_BLOCKQUOTE_REGEX =
  /^(> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\].*)((?:\n *>.*)*)(?=\n{2,}|$)/;

const CONTAINER_MATCHABLE_TYPES = [
  "banner",
  "carousel",
  "warn",
  "error",
  "danger",
  "info",
  "success",
  "warning",
  "note",
  "grid",
].join("|");

const CONTAINER_REGEX =
  /^\s*::: *([^\s{]+?) *(?:\{(.*?)\} *)?\n([\s\S]+?)\s*::: *(?:\n *)+\n?/;

const INLINE_COMPLEX_CAPTURE = /(?:\[.*?\]|<.*?>(?:.*?<.*?>)?|`.*?`|.)*?/;
const MENTION_REGEX =
  /^(\[(.*?)\])?\{((GH|TW|TG)@([A-Za-z0-9][A-Za-z0-9_-]*))\}\s?(?!\[.*?\])/;
const CODE_PLACEHOLDER_REGEX =
  /<pre data-mori-code="1" data-lang="([^"]*)" data-attrs="([^"]*)"><code>([\s\S]*?)<\/code><\/pre>/g;
const RICH_LINK_PLACEHOLDER_REGEX =
  /<div data-mori-rich-link="1" data-url="([^"]*)" data-label="([^"]*)"><\/div>/g;
const MARKDOWN_IMAGE_ELEMENT_REGEX = /<img\b[^>]*\bdata-mori-markdown-image="1"[^>]*>/i;
const FRIEND_LINK_LINE_REGEX = /\[([^\]]+)\]\(([^)]+)\)\s*\+\(([^)]+)\)(?:\s*\+\(([^)]*?)\))?/;
const FRIEND_LINK_SINGLE_SRC = "\\[[^\\]]+\\]\\([^)]+\\)\\s*\\+\\([^)]+\\)(?:\\s*\\+\\([^)]*?\\))?";
const FRIEND_LINK_BLOCK_REGEX = new RegExp(
  "(" + FRIEND_LINK_SINGLE_SRC + "(?:\\s*\\n(?:\\s*\\n)*" + FRIEND_LINK_SINGLE_SRC + ")*)",
  "gm",
);
const FRIEND_LINK_PLACEHOLDER_REGEX =
  /<div data-mori-friend-links="1" data-items="([^"]*)">[\s\S]*?<\/div>/g;
const LANGUAGE_ALIAS: Record<string, string> = {
  csharp: "c#",
  cxx: "cpp",
  js: "javascript",
  jsx: "jsx",
  md: "markdown",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  ts: "typescript",
  tsx: "tsx",
  yml: "yaml",
};

type CalloutType = "note" | "tip" | "important" | "warning" | "caution" | "info" | "success" | "error";
type LinkPreview = {
  finalUrl: string;
  domain: string;
  title: string;
  description: string;
  image: string;
  githubStars?: number;
  githubDiffStats?: { additions: number; deletions: number };
};
type ReferenceLinkDefinition = {
  target: string;
  title: string;
};

let tabsInstanceCount = 0;
let activeReferenceLinkDefinitions = new Map<string, ReferenceLinkDefinition>();
const DOC_HEAD_GUARD_ID = "73b9050e";
const DOC_HEAD_GUARD_HTML = `<div data-mori-doc-guard="${DOC_HEAD_GUARD_ID}"></div>`;

function withMarkdownRenderScope<T>(runner: () => T) {
  const previousTabsInstanceCount = tabsInstanceCount;
  tabsInstanceCount = 0;
  try {
    return runner();
  } finally {
    tabsInstanceCount = previousTabsInstanceCount;
  }
}

function toHtml(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => toHtml(item)).join("");
  }

  if (value === null || value === undefined || value === false) {
    return "";
  }

  return String(value);
}

function escapeAttributeValue(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildDeferredMarkdownImagePlaceholderSrc(target: string) {
  return `/api/blurhash/image?src=${encodeURIComponent(target)}`;
}

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function styleValueToString(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  return Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== null && item !== undefined && item !== "")
    .map(([key, item]) => `${toKebabCase(key)}:${String(item)}`)
    .join(";");
}

function parseFilenameFromAttrs(attrs: string) {
  const match = attrs.match(/filename="([^"]+)"/i);
  if (!match?.[1]) {
    return "";
  }
  return match[1].trim();
}

function encodeBase64Utf8(value: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf8").toString("base64");
  }

  const encoded = new TextEncoder().encode(value);
  let binary = "";
  encoded.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  if (typeof btoa === "function") {
    return btoa(binary);
  }

  return "";
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function slugifyMarkdownIdentifier(value: string) {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");

  return normalized || "section";
}

function normalizeExcalidrawCodeSource(rawCode: string) {
  const firstLine = rawCode
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return "";
  }

  if (firstLine.startsWith("/")) {
    return firstLine;
  }

  const parsed = parseUrlSafe(firstLine);
  if (parsed && /^https?:$/i.test(parsed.protocol)) {
    return parsed.toString();
  }

  return "";
}

function resolveCodeLanguage(input: string) {
  const candidate = input.trim().toLowerCase();
  if (!candidate) {
    return "text";
  }

  const alias = LANGUAGE_ALIAS[candidate] || candidate;
  if (Object.prototype.hasOwnProperty.call(bundledLanguages, alias)) {
    return alias;
  }

  return "text";
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
const linkPreviewPromiseCache = new Map<string, Promise<LinkPreview | null>>();

async function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = getSingletonHighlighter({
      langs: Object.keys(bundledLanguages),
      themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
    });
  }

  return highlighterPromise;
}

function buildCodeBlockFrame(highlightedHtml: string, lang: string, filename: string, rawCode: string) {
  const langLabel = lang || "text";
  const codeBase64 = encodeBase64Utf8(rawCode);
  return `<div class="mori-code-block mori-code-block-shiki">
<div class="mori-code-head">
<span class="mori-code-meta">
<span class="mori-code-lang">${escapeAttributeValue(langLabel)}</span>
${filename ? `<span class="mori-code-file">${escapeAttributeValue(filename)}</span>` : ""}
</span>
<button type="button" class="mori-code-copy" data-code-b64="${escapeAttributeValue(codeBase64)}">COPY</button>
</div>
<div class="mori-code-body">${highlightedHtml}</div>
</div>`;
}

async function applyShikiHighlight(html: string) {
  if (!html.includes('data-mori-code="1"')) {
    return html;
  }

  const matches = Array.from(html.matchAll(CODE_PLACEHOLDER_REGEX));
  if (matches.length === 0) {
    return html;
  }

  const highlighter = await getHighlighter();
  let rendered = html;

  for (const match of matches) {
    const full = match[0];
    const langRaw = decodeHtmlEntities(match[1] || "");
    const attrsRaw = decodeHtmlEntities(match[2] || "");
    const codeRaw = decodeHtmlEntities(match[3] || "");
    const lang = resolveCodeLanguage(langRaw);
    const filename = parseFilenameFromAttrs(attrsRaw);

    const highlightedHtml = highlighter.codeToHtml(codeRaw, {
      lang,
      meta: { __raw: attrsRaw },
      themes: {
        dark: "github-dark",
        light: "github-light",
      },
      transformers: [
        transformerNotationDiff({ matchAlgorithm: "v3" }),
        transformerNotationHighlight({ matchAlgorithm: "v3" }),
        transformerNotationWordHighlight({ matchAlgorithm: "v3" }),
        transformerMetaHighlight(),
      ],
    });

    const nextBlock = buildCodeBlockFrame(highlightedHtml, langRaw, filename, codeRaw);
    rendered = rendered.replace(full, nextBlock);
  }

  return rendered;
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFootnotesFooterHtml(content: string) {
  const itemRegex = /<div id="([^"]+)">([\s\S]*?)<\/div>/g;
  const items: string[] = [];
  let match: RegExpExecArray | null = itemRegex.exec(content);

  while (match) {
    const rawId = String(match[1] || "").trim();
    const rawBody = String(match[2] || "");

    if (rawId) {
      const cleanedBody = rawBody.replace(new RegExp(`^\\s*${escapeRegex(rawId)}\\s*`), "").trim();
      const footnoteId = `mori-footnote-${rawId}`;
      const refId = `mori-footnote-ref-${rawId}`;

      items.push(`<li id="${escapeAttributeValue(footnoteId)}" class="mori-footnote-item"><span class="mori-footnote-body">${cleanedBody}</span> <a href="#${escapeAttributeValue(refId)}" class="mori-footnote-backref" aria-label="返回正文">↩</a></li>`);
    }

    match = itemRegex.exec(content);
  }

  if (items.length === 0) {
    return `<footer>${content}</footer>`;
  }

  return `<footer class="mori-footnotes"><ol>${items.join("")}</ol></footer>`;
}

function parseUrlSafe(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeReferenceLinkKey(value: string) {
  return value.trim().toLowerCase();
}

function parseReferenceLinkTargetAndTitle(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let target = "";
  let remainder = "";

  if (trimmed.startsWith("<")) {
    const closing = trimmed.indexOf(">");
    if (closing <= 1) {
      return null;
    }
    target = trimmed.slice(1, closing).trim();
    remainder = trimmed.slice(closing + 1).trim();
  } else {
    const matchedTarget = trimmed.match(/^(\S+)/);
    if (!matchedTarget?.[1]) {
      return null;
    }
    target = matchedTarget[1].trim();
    remainder = trimmed.slice(matchedTarget[1].length).trim();
  }

  if (!target) {
    return null;
  }

  let title = "";
  if (remainder.length > 1) {
    const marker = remainder[0];
    if (marker === "\"" || marker === "'" || marker === "(") {
      const expectedClosing = marker === "(" ? ")" : marker;
      if (remainder.endsWith(expectedClosing)) {
        title = remainder.slice(1, -1).trim();
      }
    }
  }

  return {
    target,
    title,
  } satisfies ReferenceLinkDefinition;
}

function parseReferenceLinkDefinitions(markdown: string) {
  const definitions = new Map<string, ReferenceLinkDefinition>();
  const lines = markdown.split(/\r?\n/);

  for (const line of lines) {
    const matched = line.match(/^\s{0,3}\[([^\]\n]+)\]:\s*(.+)\s*$/);
    if (!matched?.[1] || !matched[2]) {
      continue;
    }

    const key = normalizeReferenceLinkKey(matched[1]);
    const parsed = parseReferenceLinkTargetAndTitle(matched[2]);
    if (!key || !parsed) {
      continue;
    }

    definitions.set(key, parsed);
  }

  return definitions;
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) {
    return true;
  }

  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return false;
  }

  const parts = host.split(".").map((value) => Number.parseInt(value, 10));
  if (parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
    return true;
  }

  if (parts[0] === 10 || parts[0] === 127) {
    return true;
  }
  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }

  return false;
}

function normalizeText(value: string) {
  return decodeHtmlEntities(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function readTagAttribute(tag: string, name: string) {
  const escapedName = escapeRegex(name);
  const pattern = new RegExp(
    `${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + "`" + `]+))`,
    "i",
  );
  const matched = tag.match(pattern);
  return normalizeText(matched?.[1] || matched?.[2] || matched?.[3] || "");
}

function readMetaContent(html: string, names: string[]) {
  const targetNames = new Set(names.map((name) => name.toLowerCase()));
  const tags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const key = (readTagAttribute(tag, "property") || readTagAttribute(tag, "name")).toLowerCase();
    if (!key || !targetNames.has(key)) {
      continue;
    }

    const content = readTagAttribute(tag, "content");
    if (content) {
      return content;
    }
  }

  return "";
}

function readDocumentTitle(html: string) {
  const matched = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return normalizeText(matched?.[1] || "");
}

function readIconHref(html: string) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = readTagAttribute(tag, "rel").toLowerCase();
    if (!rel) {
      continue;
    }

    const relTokens = rel
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);
    const hasIconRel =
      relTokens.includes("icon") ||
      relTokens.includes("apple-touch-icon") ||
      (relTokens.includes("shortcut") && relTokens.includes("icon"));
    if (!hasIconRel) {
      continue;
    }

    const href = readTagAttribute(tag, "href");
    if (href) {
      return href;
    }
  }

  return "";
}

function toAbsoluteUrl(candidate: string, base: string) {
  const raw = candidate.trim();
  if (!raw) {
    return "";
  }

  try {
    return new URL(raw, base).toString();
  } catch {
    return "";
  }
}

function getGitHubOwnerFromUrl(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }

  if (host === "gist.github.com") {
    const owner = segments[0] || "";
    return /^[a-z0-9-]{1,39}$/i.test(owner) ? owner : "";
  }

  if (host !== "github.com") {
    return "";
  }

  const owner = segments[0] || "";
  if (!/^[a-z0-9-]{1,39}$/i.test(owner)) {
    return "";
  }

  const blockedOwners = new Set([
    "about",
    "account",
    "apps",
    "blog",
    "collections",
    "contact",
    "customer-stories",
    "enterprise",
    "events",
    "explore",
    "features",
    "issues",
    "login",
    "marketplace",
    "new",
    "notifications",
    "orgs",
    "organizations",
    "pricing",
    "pulls",
    "readme",
    "search",
    "security",
    "settings",
    "site",
    "solutions",
    "sponsors",
    "teams",
    "topics",
    "trending",
  ]);

  if (blockedOwners.has(owner.toLowerCase())) {
    return "";
  }

  return owner;
}

function getGitHubAvatarUrl(url: URL) {
  const owner = getGitHubOwnerFromUrl(url);
  if (!owner) {
    return "";
  }
  return `https://github.com/${encodeURIComponent(owner)}.png?size=96`;
}

function getGitHubRepoFromUrl(url: URL): { owner: string; repo: string } | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "github.com") {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  const owner = segments[0] || "";
  const repo = (segments[1] || "").replace(/\.git$/, "");
  if (!owner || !repo || !/^[a-z0-9._-]+$/i.test(owner) || !/^[a-z0-9._-]+$/i.test(repo)) {
    return null;
  }
  return { owner, repo };
}

const githubStarsCache = new Map<string, Promise<number | null>>();

async function fetchGitHubStars(owner: string, repo: string): Promise<number | null> {
  const key = `${owner}/${repo}`.toLowerCase();
  const cached = githubStarsCache.get(key);
  if (cached) {
    return cached;
  }

  const job = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "MoriBot/1.0",
      };
      const ghToken = process.env.GITHUB_TOKEN;
      if (ghToken) {
        headers.Authorization = `Bearer ${ghToken}`;
      }
      const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
        signal: controller.signal,
        headers,
      });
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as { stargazers_count?: number };
      return typeof data.stargazers_count === "number" ? data.stargazers_count : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })();

  githubStarsCache.set(key, job);
  return job;
}

function formatStarCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(count);
}

function getGitHubCommitFromUrl(url: URL): { owner: string; repo: string; sha: string } | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "github.com") {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 4 || segments[2] !== "commit") {
    return null;
  }
  const owner = segments[0];
  const repo = segments[1];
  const sha = segments[3];
  if (!owner || !repo || !sha || !/^[a-f0-9]{7,40}$/i.test(sha)) {
    return null;
  }
  return { owner, repo, sha };
}

function getGitHubPullFromUrl(url: URL): { owner: string; repo: string; number: number } | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "github.com") {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 4 || segments[2] !== "pull") {
    return null;
  }
  const owner = segments[0];
  const repo = segments[1];
  const prNum = parseInt(segments[3], 10);
  if (!owner || !repo || !Number.isFinite(prNum) || prNum <= 0) {
    return null;
  }
  return { owner, repo, number: prNum };
}

const githubDiffStatsCache = new Map<string, Promise<{ additions: number; deletions: number } | null>>();

function buildGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "MoriBot/1.0",
  };
  const ghToken = process.env.GITHUB_TOKEN;
  if (ghToken) {
    headers.Authorization = `Bearer ${ghToken}`;
  }
  return headers;
}

async function fetchGitHubCommitStats(
  owner: string,
  repo: string,
  sha: string,
): Promise<{ additions: number; deletions: number } | null> {
  const key = `commit:${owner}/${repo}/${sha}`.toLowerCase();
  const cached = githubDiffStatsCache.get(key);
  if (cached) {
    return cached;
  }

  const job = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`,
        { signal: controller.signal, headers: buildGitHubHeaders() },
      );
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as { stats?: { additions?: number; deletions?: number } };
      if (!data.stats || typeof data.stats.additions !== "number" || typeof data.stats.deletions !== "number") {
        return null;
      }
      return { additions: data.stats.additions, deletions: data.stats.deletions };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })();

  githubDiffStatsCache.set(key, job);
  return job;
}

async function fetchGitHubPullStats(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ additions: number; deletions: number } | null> {
  const key = `pr:${owner}/${repo}/${prNumber}`.toLowerCase();
  const cached = githubDiffStatsCache.get(key);
  if (cached) {
    return cached;
  }

  const job = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}`,
        { signal: controller.signal, headers: buildGitHubHeaders() },
      );
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as { additions?: number; deletions?: number };
      if (typeof data.additions !== "number" || typeof data.deletions !== "number") {
        return null;
      }
      return { additions: data.additions, deletions: data.deletions };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })();

  githubDiffStatsCache.set(key, job);
  return job;
}

function buildFallbackCardMeta(target: string, label: string): LinkPreview {
  const url = parseUrlSafe(target);
  if (!url) {
    return {
      finalUrl: target,
      domain: "",
      title: label || target,
      description: target,
      image: "",
    } satisfies LinkPreview;
  }

  const domain = url.hostname.replace(/^www\./, "");
  const decodedPath = safeDecodeURIComponent(url.pathname || "/");
  const pathWithSearch = `${decodedPath}${url.search || ""}${url.hash || ""}`.trim() || "/";
  const fallbackTitleFromPath = (() => {
    const compact = decodedPath.replace(/\/+$/, "").replace(/^\/+/, "");
    if (!compact) {
      return domain;
    }
    const segments = compact.split("/").filter(Boolean);
    const tail = segments[segments.length - 1] || compact;
    return tail.length > 2 ? tail : `${domain}${decodedPath}`;
  })();

  const normalizedLabel = label.trim();
  const title =
    normalizedLabel && normalizedLabel !== target && normalizedLabel !== `${url.protocol}//${url.host}${url.pathname}`
      ? normalizedLabel
      : fallbackTitleFromPath;
  const githubAvatar = getGitHubAvatarUrl(url);

  return {
    finalUrl: url.toString(),
    domain,
    title: normalizeText(title),
    description: normalizeText(`${domain}${pathWithSearch === "/" ? "" : pathWithSearch}`),
    image: githubAvatar || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`,
  } satisfies LinkPreview;
}

async function fetchLinkPreview(target: string, label: string): Promise<LinkPreview | null> {
  const base = buildFallbackCardMeta(target, label);
  const parsed = parseUrlSafe(base.finalUrl);
  if (!parsed || !/^https?:$/i.test(parsed.protocol) || isPrivateHostname(parsed.hostname)) {
    return base;
  }

  const cacheKey = parsed.toString();
  const cached = linkPreviewPromiseCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const job = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(cacheKey, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (compatible; MoriBot/1.0; +https://github.com/Innei/book-ssg-template)",
        },
      });

      if (!response.ok) {
        return base;
      }

      const finalUrl = response.url || base.finalUrl;
      const finalParsed = parseUrlSafe(finalUrl) || parsed;
      const githubAvatar = getGitHubAvatarUrl(finalParsed);
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (!contentType.includes("text/html")) {
        return {
          ...base,
          finalUrl,
          domain: finalParsed.hostname.replace(/^www\./, ""),
          image:
            githubAvatar ||
            base.image ||
            `https://www.google.com/s2/favicons?domain=${encodeURIComponent(finalParsed.hostname)}&sz=64`,
        } satisfies LinkPreview;
      }

      const html = (await response.text()).slice(0, 220_000);
      const previewTitle =
        readMetaContent(html, ["og:title", "twitter:title", "title"]) || readDocumentTitle(html);
      const previewDesc = readMetaContent(html, ["og:description", "twitter:description", "description"]);
      const previewImage = readMetaContent(html, ["og:image", "twitter:image", "og:image:url"]);
      const iconHref = readIconHref(html);
      const resolvedImage =
        githubAvatar ||
        toAbsoluteUrl(previewImage, finalUrl) ||
        toAbsoluteUrl(iconHref, finalUrl) ||
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(finalParsed.hostname)}&sz=64`;

      const ghRepo = getGitHubRepoFromUrl(finalParsed);
      const isRepoRoot = ghRepo !== null && finalParsed.pathname.split("/").filter(Boolean).length === 2;

      let githubStars: number | undefined;
      if (isRepoRoot && ghRepo) {
        const stars = await fetchGitHubStars(ghRepo.owner, ghRepo.repo);
        if (stars !== null) {
          githubStars = stars;
        }
      }

      let finalTitle = previewTitle || base.title;
      if (isRepoRoot && finalTitle) {
        finalTitle = finalTitle
          .replace(/^GitHub\s*[-–—]\s*/i, "")
          .replace(/:\s.*$/, "");
      }

      const ghCommit = getGitHubCommitFromUrl(finalParsed);
      const ghPull = getGitHubPullFromUrl(finalParsed);
      let githubDiffStats: { additions: number; deletions: number } | undefined;
      if (ghCommit) {
        const stats = await fetchGitHubCommitStats(ghCommit.owner, ghCommit.repo, ghCommit.sha);
        if (stats) {
          githubDiffStats = stats;
        }
      } else if (ghPull) {
        const stats = await fetchGitHubPullStats(ghPull.owner, ghPull.repo, ghPull.number);
        if (stats) {
          githubDiffStats = stats;
        }
      }

      return {
        finalUrl,
        domain: finalParsed.hostname.replace(/^www\./, ""),
        title: finalTitle,
        description: previewDesc || base.description,
        image: resolvedImage,
        githubStars,
        githubDiffStats,
      } satisfies LinkPreview;
    } catch {
      return base;
    } finally {
      clearTimeout(timeout);
    }
  })();

  linkPreviewPromiseCache.set(cacheKey, job);
  return job;
}

function extractTextFromMarkdownNode(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractTextFromMarkdownNode(item)).join("");
  }

  if (typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.content === "string") {
      return candidate.content;
    }
    if (candidate.content) {
      return extractTextFromMarkdownNode(candidate.content);
    }
    if (typeof candidate.value === "string") {
      return candidate.value;
    }
  }

  return "";
}

function parseYoutubeId(url: URL) {
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") {
    return url.pathname.replace(/^\/+/, "").split("/")[0] || "";
  }

  if (host.endsWith("youtube.com")) {
    if (url.pathname === "/watch") {
      return url.searchParams.get("v") || "";
    }

    if (url.pathname.startsWith("/embed/")) {
      return url.pathname.split("/")[2] || "";
    }

    if (url.pathname.startsWith("/shorts/")) {
      return url.pathname.split("/")[2] || "";
    }
  }

  return "";
}

function parseBilibiliParams(url: URL): URLSearchParams | null {
  const host = url.hostname.toLowerCase();

  if (host === "bilibili.com" || host === "www.bilibili.com") {
    if (url.pathname.startsWith("/video/")) {
      const parts = url.pathname.split("/");
      const id = parts[2] || "";
      if (id) {
        const params = new URLSearchParams({ high_quality: "1", danmaku: "0", autoplay: "0" });
        if (id.toLowerCase().startsWith("bv")) {
          params.set("bvid", id);
        }
        if (id.toLowerCase().startsWith("av")) {
          params.set("aid", id.replace(/^av/i, ""));
        }
        if (url.searchParams.has("p")) params.set("p", url.searchParams.get("p")!);
        if (url.searchParams.has("t")) params.set("t", url.searchParams.get("t")!);
        if (url.searchParams.has("autoplay")) params.set("autoplay", url.searchParams.get("autoplay")!);
        return params;
      }
    }
  }

  if (host === "player.bilibili.com") {
    if (url.pathname.startsWith("/player.html") || url.pathname === "/player.html") {
      const params = new URLSearchParams(url.searchParams.toString());
      if (!params.has("high_quality")) params.set("high_quality", "1");
      if (!params.has("danmaku")) params.set("danmaku", "0");
      if (!params.has("autoplay")) params.set("autoplay", "0");
      return params;
    }
  }

  return null;
}

function isCodesandboxUrl(url: URL) {
  return url.hostname.toLowerCase() === "codesandbox.io";
}

function isExcalidrawUrl(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return host === "excalidraw.com" || host === "app.excalidraw.com";
}

function buildExcalidrawEmbedUrl(url: URL) {
  const next = new URL(url.toString());
  if (!next.searchParams.has("embed")) {
    next.searchParams.set("embed", "true");
  }
  if (!next.searchParams.has("viewMode")) {
    next.searchParams.set("viewMode", "true");
  }
  return next.toString();
}

function renderRichEmbedFromUrl(url: URL) {
  const youtubeId = parseYoutubeId(url);
  if (youtubeId) {
    const embed = `https://www.youtube.com/embed/${escapeAttributeValue(youtubeId)}`;
    return `<div class="mori-rich-link mori-rich-embed mori-rich-embed-youtube">
<iframe src="${embed}" title="YouTube video player" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
</div>`;
  }

  const bilibiliParams = parseBilibiliParams(url);
  if (bilibiliParams) {
    const embed = `https://player.bilibili.com/player.html?${bilibiliParams.toString()}`;
    return `<div class="mori-rich-link mori-rich-embed mori-rich-embed-bilibili">
<iframe src="${embed}" title="Bilibili video player" loading="lazy" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen></iframe>
</div>`;
  }

  if (isCodesandboxUrl(url)) {
    if (url.pathname.startsWith("/s/")) {
      const id = url.pathname.slice(3).replace(/^\/+/, "");
      const embedUrl = `https://codesandbox.io/embed/${escapeAttributeValue(id)}?fontsize=14&hidenavigation=1&theme=dark`;
      return `<div class="mori-rich-link mori-rich-embed mori-rich-embed-codesandbox">
<iframe src="${embedUrl}" title="CodeSandbox" loading="lazy" sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"></iframe>
</div>`;
    }

    if (url.pathname.startsWith("/p/devbox/")) {
      const embedUrl = `${url.toString()}${url.search ? "&" : "?"}embed=1`;
      return `<div class="mori-rich-link mori-rich-embed mori-rich-embed-codesandbox">
<iframe src="${escapeAttributeValue(embedUrl)}" title="CodeSandbox Devbox" loading="lazy" sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"></iframe>
</div>`;
    }
  }

  if (isExcalidrawUrl(url)) {
    const embedUrl = buildExcalidrawEmbedUrl(url);
    return `<div class="mori-rich-link mori-rich-embed mori-rich-embed-excalidraw">
<iframe src="${escapeAttributeValue(embedUrl)}" title="Excalidraw" loading="lazy" sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"></iframe>
</div>`;
  }

  return "";
}

function renderRichLinkCard(target: string, label: string, preview: LinkPreview | null) {
  const url = parseUrlSafe(target);
  if (!url) {
    const safeTarget = sanitizeUrl(target) || "";
    if (!safeTarget) {
      return "";
    }
    return `<p><a href="${escapeAttributeValue(safeTarget)}" target="_blank" rel="noopener noreferrer">${escapeAttributeValue(
      label || safeTarget,
    )}</a></p>`;
  }

  const embedHtml = renderRichEmbedFromUrl(url);
  if (embedHtml) {
    return embedHtml;
  }

  const meta = preview ?? buildFallbackCardMeta(target, label);
  const safeHref = sanitizeUrl(meta.finalUrl) || sanitizeUrl(target) || "";
  if (!safeHref) {
    return "";
  }

  const starsHtml = meta.githubStars != null
    ? `<span class="mori-link-card-stars"><svg class="mori-link-card-star-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path></svg>${formatStarCount(meta.githubStars)}</span>`
    : "";

  const diffHtml = meta.githubDiffStats
    ? `<span class="mori-link-card-diff"><span class="mori-link-card-diff-add">+${meta.githubDiffStats.additions.toLocaleString()}</span><span class="mori-link-card-diff-del">-${meta.githubDiffStats.deletions.toLocaleString()}</span></span>`
    : "";

  const descHtml = diffHtml || `<span class="mori-link-card-desc">${escapeAttributeValue(meta.description)}</span>`;

  return `<div class="mori-rich-link">
<a class="mori-link-card-grid" href="${escapeAttributeValue(safeHref)}" target="_blank" rel="noopener noreferrer">
<span class="mori-link-card-contents">
<span class="mori-link-card-title">${escapeAttributeValue(meta.title)}</span>
${descHtml}
${starsHtml}
</span>
<img class="mori-link-card-image" src="${escapeAttributeValue(meta.image)}" alt="" loading="lazy" aria-hidden="true">
</a>
</div>`;
}

async function applyRichLinkPreview(html: string) {
  if (!html.includes('data-mori-rich-link="1"')) {
    return html;
  }

  const matches = Array.from(html.matchAll(RICH_LINK_PLACEHOLDER_REGEX));
  if (matches.length === 0) {
    return html;
  }

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const full = match[0];
      const target = decodeHtmlEntities(match[1] || "");
      const label = decodeHtmlEntities(match[2] || "");
      const preview = await fetchLinkPreview(target, label);
      const card = renderRichLinkCard(target, label, preview);
      return {
        card,
        full,
      };
    }),
  );

  let rendered = html;
  replacements.forEach((replacement) => {
    rendered = rendered.replace(replacement.full, replacement.card);
  });
  return rendered;
}

function resolveMentionUrl(prefix: string, name: string) {
  if (!prefix || !name) {
    return "";
  }

  const normalizedPrefix = prefix.toUpperCase();
  if (normalizedPrefix === "GH") {
    return `https://github.com/${name}`;
  }
  if (normalizedPrefix === "TW") {
    return `https://x.com/${name}`;
  }
  if (normalizedPrefix === "TG") {
    return `https://t.me/${name}`;
  }
  return "";
}

function createHtmlElement(
  tag: Parameters<NonNullable<MarkdownToJSX.Options["createElement"]>>[0],
  props: Record<string, unknown> = {},
  ...children: unknown[]
) {
  if (typeof tag !== "string") {
    return toHtml(children);
  }

  if (tag === "Tab" || tag === "tab") {
    const label = String(props.label || props.title || "").trim() || "Tab";
    return `<mori-tab data-label="${escapeAttributeValue(label)}">${toHtml(children)}</mori-tab>`;
  }

  if (tag === "Tabs" || tag === "tabs") {
    const source = toHtml(children);
    const tabRegex = /<mori-tab data-label="([^"]*)">([\s\S]*?)<\/mori-tab>/g;
    const tabs: Array<{ label: string; content: string }> = [];
    let matched = tabRegex.exec(source);
    while (matched) {
      tabs.push({
        label: decodeHtmlEntities(matched[1] || "Tab") || "Tab",
        content: matched[2] || "",
      });
      matched = tabRegex.exec(source);
    }

    if (tabs.length === 0) {
      return source;
    }

    tabsInstanceCount += 1;
    const rootId = `mori-tabs-${tabsInstanceCount}`;

    const triggers = tabs
      .map((tab, index) => {
        const active = index === 0;
        const triggerId = `${rootId}-trigger-${index}`;
        const panelId = `${rootId}-panel-${index}`;
        return `<button type="button" id="${triggerId}" class="mori-tab-trigger${active ? " is-active" : ""
          }" role="tab" data-tab-index="${index}" aria-controls="${panelId}" aria-selected="${active ? "true" : "false"
          }" tabindex="${active ? "0" : "-1"}">${escapeAttributeValue(tab.label)}</button>`;
      })
      .join("");

    const panels = tabs
      .map((tab, index) => {
        const active = index === 0;
        const triggerId = `${rootId}-trigger-${index}`;
        const panelId = `${rootId}-panel-${index}`;
        return `<div id="${panelId}" class="mori-tab-panel${active ? " is-active" : ""}" role="tabpanel" data-tab-index="${index}" aria-labelledby="${triggerId}" tabindex="0">${tab.content}</div>`;
      })
      .join("");

    return `<div id="${rootId}" class="mori-tabs-root" data-mori-tabs="1">
<div class="mori-tabs-list" role="tablist">${triggers}</div>
<div class="mori-tabs-panels">${panels}</div>
</div>`;
  }

  if (tag === "Excalidraw" || tag === "excalidraw") {
    const rawUrl = String(props.url || props.src || props.href || "").trim();
    const safeUrl = sanitizeUrl(rawUrl) || "";
    const parsed = safeUrl ? parseUrlSafe(safeUrl) : null;
    if (!parsed || !isExcalidrawUrl(parsed)) {
      return "";
    }
    const embedUrl = buildExcalidrawEmbedUrl(parsed);
    return `<div class="mori-rich-link mori-rich-embed mori-rich-embed-excalidraw">
<iframe src="${escapeAttributeValue(embedUrl)}" title="Excalidraw" loading="lazy" sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"></iframe>
</div>`;
  }

  if (tag === "footer") {
    return buildFootnotesFooterHtml(toHtml(children));
  }

  const attributes = Object.entries(props)
    .filter(([key, value]) => key !== "key" && value !== null && value !== undefined && value !== false)
    .map(([key, value]) => {
      const normalizedKey = key === "className" ? "class" : key;
      if (normalizedKey === "style") {
        const styleText = styleValueToString(value);
        if (!styleText) {
          return "";
        }
        return `style="${escapeAttributeValue(styleText)}"`;
      }
      if (value === true) {
        return normalizedKey;
      }
      return `${normalizedKey}="${escapeAttributeValue(String(value))}"`;
    })
    .filter(Boolean)
    .join(" ");

  const openTag = attributes.length > 0 ? `<${tag} ${attributes}>` : `<${tag}>`;

  if (tag === "img" || tag === "br" || tag === "hr" || tag === "input") {
    return openTag;
  }

  return `${openTag}${toHtml(children)}</${tag}>`;
}

function normalizeCalloutType(type: string | undefined): CalloutType {
  const normalized = (type || "").trim().toLowerCase();

  if (normalized === "warning" || normalized === "warn") {
    return "warning";
  }
  if (normalized === "danger" || normalized === "error" || normalized === "caution") {
    return "caution";
  }
  if (normalized === "important") {
    return "important";
  }
  if (normalized === "success") {
    return "success";
  }
  if (normalized === "tip") {
    return "tip";
  }
  if (normalized === "note" || normalized === "info") {
    return "note";
  }

  return "info";
}

function calloutIcon(type: CalloutType) {
  if (type === "note" || type === "info") {
    return '<svg class="mori-callout-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>';
  }
  if (type === "tip") {
    return '<svg class="mori-callout-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"></path></svg>';
  }
  if (type === "important") {
    return '<svg class="mori-callout-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>';
  }
  if (type === "warning") {
    return '<svg class="mori-callout-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>';
  }
  if (type === "caution" || type === "error") {
    return '<svg class="mori-callout-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>';
  }
  if (type === "success") {
    return '<svg class="mori-callout-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z"></path></svg>';
  }
  return '<svg class="mori-callout-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>';
}

function calloutLabel(type: CalloutType) {
  if (type === "note") {
    return "Note";
  }
  if (type === "tip") {
    return "Tip";
  }
  if (type === "important") {
    return "Important";
  }
  if (type === "warning") {
    return "Warning";
  }
  if (type === "caution") {
    return "Caution";
  }
  if (type === "success") {
    return "Success";
  }
  if (type === "error") {
    return "Error";
  }
  return "Info";
}

function renderNestedMarkdown(source: string) {
  return toHtml(
    compiler(source, {
      ...markdownOptions,
      forceBlock: true,
      wrapper: null,
    }),
  );
}

const SpoilerRule: MarkdownToJSX.Rule = {
  match: simpleInlineRegex(new RegExp(`^\\|\\|(${INLINE_COMPLEX_CAPTURE.source})\\|\\|`)),
  order: Priority.LOW,
  parse: parseCaptureInline,
  react(node, output, state) {
    return `<del class="mori-spoiler" title="你知道的太多了">${toHtml(output(node.content, state))}</del>`;
  },
};

const MarkRule: MarkdownToJSX.Rule = {
  match: simpleInlineRegex(new RegExp(`^==(${INLINE_COMPLEX_CAPTURE.source})==`)),
  order: Priority.LOW,
  parse: parseCaptureInline,
  react(node, output, state) {
    return `<mark><span>${toHtml(output(node.content, state))}</span></mark>`;
  },
};

const InsertRule: MarkdownToJSX.Rule = {
  match: simpleInlineRegex(new RegExp(`^\\+\\+(${INLINE_COMPLEX_CAPTURE.source})\\+\\+`)),
  order: Priority.LOW,
  parse: parseCaptureInline,
  react(node, output, state) {
    return `<ins>${toHtml(output(node.content, state))}</ins>`;
  },
};

const MentionRule: MarkdownToJSX.Rule = {
  match: simpleInlineRegex(MENTION_REGEX),
  order: Priority.MIN,
  parse(capture) {
    return {
      type: "mention",
      displayName: capture[2] || "",
      prefix: capture[4] || "",
      name: capture[5] || "",
    };
  },
  react(node) {
    const prefix = String(node.prefix || "");
    const name = String(node.name || "");
    const displayName = String(node.displayName || name);
    const url = resolveMentionUrl(prefix, name);

    if (!url || !displayName) {
      return "";
    }

    return `<a class="mori-mention" href="${escapeAttributeValue(url)}" target="_blank" rel="noopener noreferrer">${escapeAttributeValue(displayName)}</a>`;
  },
};

const KatexInlineRule: MarkdownToJSX.Rule = {
  match: simpleInlineRegex(new RegExp(`^\\$\\s*(${INLINE_COMPLEX_CAPTURE.source})\\s*\\$`)),
  order: Priority.MED,
  parse(capture) {
    return {
      type: "katex-inline",
      formula: capture[1],
    };
  },
  react(node) {
    return `<span class="mori-katex">${katex.renderToString(String(node.formula || ""), {
      displayMode: false,
      output: "mathml",
      throwOnError: false,
    })}</span>`;
  },
};

const KatexBlockRule: MarkdownToJSX.Rule = {
  match: blockRegex(/^\s*\$\$ *([\s\S]+?) *\$\$ *(?:\n *)+\n?/),
  order: Priority.LOW,
  parse(capture) {
    return {
      type: "katex-block",
      formula: capture[1] || "",
    };
  },
  react(node) {
    return `<div class="mori-katex-block"><span class="mori-katex">${katex.renderToString(
      String(node.formula || ""),
      {
        displayMode: true,
        output: "mathml",
        throwOnError: false,
      },
    )}</span></div>`;
  },
};

function preprocessFriendLinks(markdown: string): string {
  // Protect code blocks from being matched by friend-link regex.
  // Replace fenced (``` / ~~~) and indented code blocks with placeholders,
  // run the friend-link replacement, then restore them.
  const codeBlocks: string[] = [];
  const CODE_FENCE_REGEX = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1\s*$/gm;
  const CODE_INDENT_REGEX = /^(?: {4}|\t).+(?:\n(?:(?: {4}|\t).+|\s*))*$/gm;

  let protected_ = markdown.replace(CODE_FENCE_REGEX, (m) => {
    const idx = codeBlocks.length;
    codeBlocks.push(m);
    return `\x00CODEBLOCK_${idx}\x00`;
  });

  protected_ = protected_.replace(CODE_INDENT_REGEX, (m) => {
    const idx = codeBlocks.length;
    codeBlocks.push(m);
    return `\x00CODEBLOCK_${idx}\x00`;
  });

  const replaced = protected_.replace(FRIEND_LINK_BLOCK_REGEX, (block) => {
    const lines = block.split("\n").filter((line) => line.trim());
    const items: Array<{ name: string; url: string; image: string; description: string }> = [];

    for (const line of lines) {
      const matched = line.match(FRIEND_LINK_LINE_REGEX);
      if (matched) {
        items.push({
          name: matched[1] || "",
          url: matched[2] || "",
          image: matched[3] || "",
          description: matched[4] || "",
        });
      }
    }

    if (items.length === 0) {
      return block;
    }

    const encoded = encodeBase64Utf8(JSON.stringify(items));
    return `<div data-mori-friend-links="1" data-items="${escapeAttributeValue(encoded)}"></div>\n\n`;
  });

  // Restore code blocks
  return replaced.replace(/\x00CODEBLOCK_(\d+)\x00/g, (_, idx) => codeBlocks[Number(idx)] || "");
}

function applyFriendLinksPlaceholder(html: string): string {
  if (!html.includes('data-mori-friend-links="1"')) {
    return html;
  }

  return html.replace(FRIEND_LINK_PLACEHOLDER_REGEX, (_, encodedItems) => {
    let items: Array<{ name: string; url: string; image: string; description: string }>;
    try {
      const raw = typeof Buffer !== "undefined"
        ? Buffer.from(encodedItems, "base64").toString("utf8")
        : new TextDecoder().decode(
          Uint8Array.from(atob(encodedItems), (c) => c.charCodeAt(0)),
        );
      items = JSON.parse(raw) as typeof items;
    } catch {
      return "";
    }

    if (!Array.isArray(items) || items.length === 0) {
      return "";
    }

    const cards = items
      .map((link) => {
        const safeHref = sanitizeUrl(link.url) || "";
        if (!safeHref) {
          return "";
        }

        const descHtml = link.description
          ? `<span class="mori-friend-card-desc">${escapeHtmlText(decodeHtmlEntities(link.description))}</span>`
          : `<span class="mori-friend-card-desc"></span>`;

        return `<a class="mori-friend-card" href="${escapeAttributeValue(safeHref)}" target="_blank" rel="noopener noreferrer">
<img class="mori-friend-card-avatar" src="${escapeAttributeValue(link.image)}" alt="" loading="lazy">
<span class="mori-friend-card-name">${escapeHtmlText(decodeHtmlEntities(link.name))}</span>
${descHtml}
</a>`;
      })
      .filter(Boolean)
      .join("");

    return `<div class="mori-friend-links">${cards}</div>`;
  });
}

const AlertsRule: MarkdownToJSX.Rule = {
  match: blockRegex(ALERT_BLOCKQUOTE_REGEX),
  order: Priority.HIGH,
  parse(capture) {
    return {
      raw: capture[0],
      parsed: {
        type: capture[2] || "",
        body: capture[3] || "",
      },
    };
  },
  react(node) {
    const rawType = String(node.parsed?.type || "");
    const type = normalizeCalloutType(rawType);
    const bodyRaw = String(node.parsed?.body || "");
    const body = bodyRaw.replace(/^> */gm, "").trim();

    return `<aside class="mori-callout mori-callout-${type}" data-callout="${type}">
<p class="mori-callout-title">${calloutIcon(type)}${calloutLabel(type)}</p>
<div class="mori-callout-content">${renderNestedMarkdown(body)}</div>
</aside>`;
  },
};

const ContainerRule: MarkdownToJSX.Rule = {
  match(source: string) {
    const result = CONTAINER_REGEX.exec(source);
    if (!result) {
      return null;
    }

    const type = result[1] || "";
    if (!type.match(CONTAINER_MATCHABLE_TYPES)) {
      return null;
    }

    return result;
  },
  order: Priority.MED,
  parse(capture) {
    return {
      node: {
        type: capture[1] || "",
        params: capture[2] || "",
        content: capture[3] || "",
      },
    };
  },
  react(node) {
    const type = String(node.node?.type || "").trim().toLowerCase();
    const params = String(node.node?.params || "").trim().toLowerCase();
    const content = String(node.node?.content || "").trim();

    const mappedType = normalizeCalloutType(type === "banner" ? params : type);

    if (
      type === "banner" ||
      type === "warn" ||
      type === "error" ||
      type === "danger" ||
      type === "info" ||
      type === "success" ||
      type === "warning" ||
      type === "note"
    ) {
      return `<aside class="mori-callout mori-callout-${mappedType}" data-callout="${mappedType}">
<p class="mori-callout-title">${calloutIcon(mappedType)}${calloutLabel(mappedType)}</p>
<div class="mori-callout-content">${renderNestedMarkdown(content)}</div>
</aside>`;
    }

    return `<div class="mori-container" data-container="${type || "default"}">${renderNestedMarkdown(content)}</div>`;
  },
};

const markdownOptions: MarkdownToJSX.Options = {
  additionalParserRules: {
    alerts: AlertsRule,
    container: ContainerRule,
    ins: InsertRule,
    katexBlock: KatexBlockRule,
    katexInline: KatexInlineRule,
    mark: MarkRule,
    mention: MentionRule,
    spoiler: SpoilerRule,
  },
  createElement: createHtmlElement,
  extendsRules: {
    link: {
      react(node, output, state) {
        const target = String(node.target || "").trim();
        const safeTarget = sanitizeUrl(target) || "";
        const title = String(node.title || "");
        const labelText = extractTextFromMarkdownNode(node.content).trim();
        const labelHtml = toHtml(output(node.content, state));
        const isMarkdownImageLink = MARKDOWN_IMAGE_ELEMENT_REGEX.test(labelHtml);

        if (!safeTarget) {
          return labelText;
        }

        const parsed = parseUrlSafe(safeTarget);
        const isExternal = Boolean(parsed && /^(https?:|mailto:|tel:)/i.test(safeTarget));
        const attrs = [
          `href="${escapeAttributeValue(safeTarget)}"`,
          `class="${isMarkdownImageLink ? "mori-markdown-image-link" : "mori-inline-link"}"`,
          title ? `title="${escapeAttributeValue(title)}"` : "",
          isExternal ? `target="_blank"` : "",
          isExternal ? `rel="noopener noreferrer"` : "",
        ]
          .filter(Boolean)
          .join(" ");

        if (isMarkdownImageLink) {
          return `<a ${attrs}>${labelHtml}</a>`;
        }

        const safeLabel = /<a\b/i.test(labelHtml)
          ? escapeAttributeValue(decodeHtmlEntities(labelHtml.replace(/<[^>]+>/g, "")).trim() || safeTarget)
          : labelHtml || escapeAttributeValue(safeTarget);

        return `<a ${attrs}><span class="mori-link-text">${safeLabel}</span></a>`;
      },
    },
    refLink: {
      react(node, output, state) {
        const labelText = extractTextFromMarkdownNode(node.content).trim();
        const labelHtml = toHtml(output(node.content, state));
        const isMarkdownImageLink = MARKDOWN_IMAGE_ELEMENT_REGEX.test(labelHtml);
        const refRaw = String(node.ref || "").trim();
        const lookupKey = normalizeReferenceLinkKey(refRaw || labelText);
        const definition = activeReferenceLinkDefinitions.get(lookupKey);

        if (!definition) {
          const fallbackContent = (node as { fallbackContent?: unknown }).fallbackContent;
          if (fallbackContent) {
            return toHtml(output(fallbackContent as never, state));
          }
          return labelText || "";
        }

        const safeTarget = sanitizeUrl(definition.target) || "";
        if (!safeTarget) {
          return labelText;
        }

        const parsed = parseUrlSafe(safeTarget);
        const isExternal = Boolean(parsed && /^(https?:|mailto:|tel:)/i.test(safeTarget));
        const attrs = [
          `href="${escapeAttributeValue(safeTarget)}"`,
          `class="${isMarkdownImageLink ? "mori-markdown-image-link" : "mori-inline-link"}"`,
          definition.title ? `title="${escapeAttributeValue(definition.title)}"` : "",
          isExternal ? `target="_blank"` : "",
          isExternal ? `rel="noopener noreferrer"` : "",
        ]
          .filter(Boolean)
          .join(" ");

        if (isMarkdownImageLink) {
          return `<a ${attrs}>${labelHtml}</a>`;
        }

        const safeLabel = /<a\b/i.test(labelHtml)
          ? escapeAttributeValue(decodeHtmlEntities(labelHtml.replace(/<[^>]+>/g, "")).trim() || safeTarget)
          : labelHtml || escapeAttributeValue(safeTarget);

        return `<a ${attrs}><span class="mori-link-text">${safeLabel}</span></a>`;
      },
    },
    refImage: {
      react(node) {
        const refRaw = String(node.ref || "").trim();
        const alt = String(node.alt || "").trim();
        const lookupKey = normalizeReferenceLinkKey(refRaw || alt);
        const definition = activeReferenceLinkDefinitions.get(lookupKey);
        const safeTarget = sanitizeUrl(String(definition?.target || "").trim()) || "";

        if (!safeTarget) {
          return alt;
        }

        const title = String(definition?.title || "").trim();
        const attrs = [
          `src="${escapeAttributeValue(buildDeferredMarkdownImagePlaceholderSrc(safeTarget))}"`,
          `data-origin-src="${escapeAttributeValue(safeTarget)}"`,
          `alt="${escapeAttributeValue(alt)}"`,
          `loading="lazy"`,
          `decoding="async"`,
          `data-mori-markdown-image="1"`,
          title ? `title="${escapeAttributeValue(title)}"` : "",
        ]
          .filter(Boolean)
          .join(" ");

        return `<img ${attrs}>`;
      },
    },
    paragraph: {
      react(node, output, state) {
        const content = Array.isArray(node.content) ? node.content : [];
        const meaningfulNodes = content.filter((item) => {
          const itemType = String((item as Record<string, unknown>)?.type || "");
          if (itemType !== "text") {
            return true;
          }

          const text = extractTextFromMarkdownNode(item).replace(/\s+/g, "").trim();
          return text.length > 0;
        });

        if (meaningfulNodes.length === 1) {
          const single = meaningfulNodes[0] as Record<string, unknown>;
          if (single?.type === "image" || single?.type === "refImage") {
            return toHtml(output(node.content, state));
          }

          if (single?.type === "link" || single?.type === "refLink") {
            const renderedLink = toHtml(output(node.content, state));
            if (
              /class="[^"]*\bmori-markdown-image-link\b[^"]*"/i.test(renderedLink) ||
              MARKDOWN_IMAGE_ELEMENT_REGEX.test(renderedLink)
            ) {
              return renderedLink;
            }

            if (single?.type === "link") {
              const target = sanitizeUrl(String(single.target || "").trim()) || "";
              if (target && /^https?:\/\//i.test(target)) {
                const label = extractTextFromMarkdownNode(single.content).trim();
                return `<div data-mori-rich-link="1" data-url="${escapeAttributeValue(
                  target,
                )}" data-label="${escapeAttributeValue(label)}"></div>`;
              }
            }
          }
        }

        return `<p>${toHtml(output(node.content, state))}</p>`;
      },
    },
    image: {
      react(node) {
        const target = String(node.target || "").trim();
        const safeTarget = sanitizeUrl(target) || "";
        if (!safeTarget) {
          return "";
        }

        const alt = extractTextFromMarkdownNode(node.alt).trim();
        const title = String(node.title || "").trim();
        const attrs = [
          `src="${escapeAttributeValue(buildDeferredMarkdownImagePlaceholderSrc(safeTarget))}"`,
          `data-origin-src="${escapeAttributeValue(safeTarget)}"`,
          `alt="${escapeAttributeValue(alt)}"`,
          `loading="lazy"`,
          `decoding="async"`,
          `data-mori-markdown-image="1"`,
          title ? `title="${escapeAttributeValue(title)}"` : "",
        ]
          .filter(Boolean)
          .join(" ");

        return `<img ${attrs}>`;
      },
    },
    codeFenced: {
      parse(capture) {
        return {
          attrs: capture[3] || "",
          content: capture[4] || "",
          lang: capture[2] || "",
          raw: capture[0] || "",
          type: "codeBlock",
        };
      },
    },
    codeBlock: {
      react(node) {
        const rawCode = String(node.content || "");
        const attrs = String(node.attrs || "");
        const lang = String(node.lang || "").trim().toLowerCase();
        if (lang === "excalidraw") {
          const source = normalizeExcalidrawCodeSource(rawCode);
          if (source) {
            return `<div class="mori-excalidraw" data-mori-excalidraw="1" data-source="${escapeAttributeValue(source)}">
<div class="mori-excalidraw-loading">Excalidraw Loading...</div>
</div>`;
          }
        }
        return `<pre data-mori-code="1" data-lang="${escapeAttributeValue(lang)}" data-attrs="${escapeAttributeValue(attrs)}"><code>${escapeAttributeValue(rawCode)}</code></pre>`;
      },
    },
    footnoteReference: {
      react(node) {
        const target = String(node.target || "").replace(/^#/, "").trim();
        const identifier = target || slugifyMarkdownIdentifier(String(node.content || ""));
        const refId = `mori-footnote-ref-${identifier}`;
        const footnoteId = `mori-footnote-${identifier}`;
        const label = String(node.content || "").trim() || identifier;

        return `<sup id="${escapeAttributeValue(refId)}" class="mori-footnote-ref"><a class="mori-footnote-link" href="#${escapeAttributeValue(footnoteId)}">[${escapeAttributeValue(label)}]</a></sup>`;
      },
    },
  },
  forceWrapper: false,
  slugify: slugifyMarkdownIdentifier,
  wrapper: null,
};

export function renderSimpleMarkdownToHtml(rawMarkdown: string) {
  const source = rawMarkdown.trim();
  if (!source) {
    return "";
  }

  return withMarkdownRenderScope(() => {
    const preprocessed = preprocessFriendLinks(source);
    const compileSource = `${DOC_HEAD_GUARD_HTML}\n\n${preprocessed}`;

    const previousReferenceLinkDefinitions = activeReferenceLinkDefinitions;
    activeReferenceLinkDefinitions = parseReferenceLinkDefinitions(preprocessed);

    let rawHtml = "";
    try {
      rawHtml = toHtml(compiler(compileSource, markdownOptions));
    } finally {
      activeReferenceLinkDefinitions = previousReferenceLinkDefinitions;
    }

    rawHtml = rawHtml.replace(
      new RegExp(`^<div data-mori-doc-guard="${DOC_HEAD_GUARD_ID}"><\\/div>`),
      "",
    );

    return rawHtml;
  });
}

export async function renderMarkdownToHtml(rawMarkdown: string) {
  const source = rawMarkdown.trim();
  if (!source) {
    return "";
  }

  const rawHtml = withMarkdownRenderScope(() => {
    // Pre-process friend links before markdown compilation
    const preprocessed = preprocessFriendLinks(source);

    // @innei/markdown-to-jsx has a block-parsing edge case at document start
    // (the first list/hr block may not be recognized). We prepend a guard node
    // and remove only that exact leading node after compile.
    const compileSource = `${DOC_HEAD_GUARD_HTML}\n\n${preprocessed}`;

    const previousReferenceLinkDefinitions = activeReferenceLinkDefinitions;
    activeReferenceLinkDefinitions = parseReferenceLinkDefinitions(preprocessed);

    let nextHtml = "";
    try {
      nextHtml = toHtml(compiler(compileSource, markdownOptions));
    } finally {
      activeReferenceLinkDefinitions = previousReferenceLinkDefinitions;
    }

    return nextHtml.replace(
      new RegExp(`^<div data-mori-doc-guard="${DOC_HEAD_GUARD_ID}"><\\/div>`),
      "",
    );
  });

  const highlightedHtml = await applyShikiHighlight(rawHtml);
  const withRichLinks = await applyRichLinkPreview(highlightedHtml);
  return applyFriendLinksPlaceholder(withRichLinks);
}
