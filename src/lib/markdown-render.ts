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
  /^(> \[!(NOTE|IMPORTANT|WARNING)\].*)((?:\n *>.*)*)(?=\n{2,}|$)/;

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

type CalloutType = "note" | "important" | "warning" | "info" | "success" | "error";
type LinkPreview = {
  finalUrl: string;
  domain: string;
  title: string;
  description: string;
  image: string;
};
type ReferenceLinkDefinition = {
  target: string;
  title: string;
};

let tabsInstanceCount = 0;
let activeReferenceLinkDefinitions = new Map<string, ReferenceLinkDefinition>();

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

      items.push(`<li id="${escapeAttributeValue(footnoteId)}" class="mori-footnote-item">
<span class="mori-footnote-body">${cleanedBody}</span>
<a href="#${escapeAttributeValue(refId)}" class="mori-footnote-backref" aria-label="返回正文">↩</a>
</li>`);
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

function buildFallbackCardMeta(target: string, label: string) {
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

      return {
        finalUrl,
        domain: finalParsed.hostname.replace(/^www\./, ""),
        title: previewTitle || base.title,
        description: previewDesc || base.description,
        image: resolvedImage,
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

  return `<div class="mori-rich-link">
<a class="mori-link-card-grid" href="${escapeAttributeValue(safeHref)}" target="_blank" rel="noopener noreferrer">
<span class="mori-link-card-contents">
<span class="mori-link-card-title">${escapeAttributeValue(meta.title)}</span>
<span class="mori-link-card-desc">${escapeAttributeValue(meta.description)}</span>
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
      if (value === true) {
        return normalizedKey;
      }
      return `${normalizedKey}="${escapeAttributeValue(String(value))}"`;
    })
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
  if (normalized === "danger" || normalized === "error") {
    return "error";
  }
  if (normalized === "important") {
    return "important";
  }
  if (normalized === "success") {
    return "success";
  }
  if (normalized === "note" || normalized === "info") {
    return "note";
  }

  return "info";
}

function calloutLabel(type: CalloutType) {
  if (type === "note") {
    return "Note";
  }
  if (type === "important") {
    return "Important";
  }
  if (type === "warning") {
    return "Warning";
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
<p class="mori-callout-title">${calloutLabel(type)}</p>
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
<p class="mori-callout-title">${calloutLabel(mappedType)}</p>
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

        if (!safeTarget) {
          return labelText;
        }

        const parsed = parseUrlSafe(safeTarget);
        const isExternal = Boolean(parsed && /^(https?:|mailto:|tel:)/i.test(safeTarget));
        const attrs = [
          `href="${escapeAttributeValue(safeTarget)}"`,
          `class="mori-inline-link"`,
          title ? `title="${escapeAttributeValue(title)}"` : "",
          isExternal ? `target="_blank"` : "",
          isExternal ? `rel="noopener noreferrer"` : "",
        ]
          .filter(Boolean)
          .join(" ");

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
          `class="mori-inline-link"`,
          definition.title ? `title="${escapeAttributeValue(definition.title)}"` : "",
          isExternal ? `target="_blank"` : "",
          isExternal ? `rel="noopener noreferrer"` : "",
        ]
          .filter(Boolean)
          .join(" ");

        const safeLabel = /<a\b/i.test(labelHtml)
          ? escapeAttributeValue(decodeHtmlEntities(labelHtml.replace(/<[^>]+>/g, "")).trim() || safeTarget)
          : labelHtml || escapeAttributeValue(safeTarget);

        return `<a ${attrs}><span class="mori-link-text">${safeLabel}</span></a>`;
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
          if (single?.type === "image") {
            return toHtml(output(node.content, state));
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

        return `<p>${toHtml(output(node.content, state))}</p>`;
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

export async function renderMarkdownToHtml(rawMarkdown: string) {
  const source = rawMarkdown.trim();
  if (!source) {
    return "";
  }

  const previousReferenceLinkDefinitions = activeReferenceLinkDefinitions;
  activeReferenceLinkDefinitions = parseReferenceLinkDefinitions(source);

  let rawHtml = "";
  try {
    rawHtml = toHtml(compiler(source, markdownOptions));
  } finally {
    activeReferenceLinkDefinitions = previousReferenceLinkDefinitions;
  }

  const highlightedHtml = await applyShikiHighlight(rawHtml);
  return applyRichLinkPreview(highlightedHtml);
}
