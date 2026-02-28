import sanitizeHtml from "sanitize-html";

import { renderMarkdownToHtml } from "./markdown-render";
import { replaceOwoTokensWithHtml } from "./owo";
import { stripHtml } from "./typecho-normalize";
import { TocItem } from "./typecho-types";

function slugifyHeading(text: string) {
  const cleaned = text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
  return cleaned || "section";
}

async function markdownToSafeHtml(rawContent: string | undefined) {
  const source = replaceOwoTokensWithHtml(rawContent?.trim() ?? "");
  if (!source) {
    return "";
  }

  return renderMarkdownToHtml(source);
}

const MARKDOWN_IMAGE_UNIT_PATTERN =
  /<p>\s*(?:<a\b[^>]*\bmori-markdown-image-link\b[^>]*>\s*<img\b[^>]*\bdata-mori-markdown-image="1"[^>]*>\s*<\/a>|<img\b[^>]*\bdata-mori-markdown-image="1"[^>]*>)\s*<\/p>|<a\b[^>]*\bmori-markdown-image-link\b[^>]*>\s*<img\b[^>]*\bdata-mori-markdown-image="1"[^>]*>\s*<\/a>|<img\b[^>]*\bdata-mori-markdown-image="1"[^>]*>/gi;
const MARKDOWN_IMAGE_TAG_IN_UNIT_PATTERN = /<img\b[^>]*\bdata-mori-markdown-image="1"[^>]*>/i;

type MarkdownImageUnit = {
  html: string;
  start: number;
  end: number;
};

function normalizeMarkdownImageUnitHtml(unitHtml: string) {
  const paragraphMatch = unitHtml.match(/^<p>\s*([\s\S]*?)\s*<\/p>$/i);
  return paragraphMatch ? paragraphMatch[1] : unitHtml;
}

function decodeHtmlEntity(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readTagAttribute(tag: string, name: string) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const matched = tag.match(pattern);
  if (!matched) {
    return "";
  }
  return matched[1] ?? matched[2] ?? matched[3] ?? "";
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveImageFileNameFromSrc(src: string) {
  if (!src) {
    return "";
  }

  let path = src;
  try {
    const parsed = new URL(src, "https://mori.local");
    path = parsed.pathname || src;
  } catch {
    path = src.split(/[?#]/, 1)[0] || src;
  }

  const baseName = path.split("/").filter(Boolean).pop() || "";
  return safeDecodeURIComponent(baseName);
}

function resolveMarkdownImageCaption(unitHtml: string) {
  const imageTag = unitHtml.match(MARKDOWN_IMAGE_TAG_IN_UNIT_PATTERN)?.[0] || "";
  if (!imageTag) {
    return "";
  }

  const title = decodeHtmlEntity(readTagAttribute(imageTag, "title")).trim();
  const alt = decodeHtmlEntity(readTagAttribute(imageTag, "alt")).trim();
  const src = decodeHtmlEntity(readTagAttribute(imageTag, "data-origin-src") || readTagAttribute(imageTag, "src")).trim();

  return title || alt || resolveImageFileNameFromSrc(src);
}

function buildMarkdownImageSingle(unit: MarkdownImageUnit) {
  const normalized = normalizeMarkdownImageUnitHtml(unit.html);
  const caption = resolveMarkdownImageCaption(normalized);
  const captionHtml = caption ? `<figcaption class="mori-image-caption">${escapeHtmlText(caption)}</figcaption>` : "";

  return `<figure class="mori-image-single">${normalized}${captionHtml}</figure>`;
}

function buildMarkdownImageGallery(units: MarkdownImageUnit[]) {
  const count = units.length;
  if (count < 2) {
    return "";
  }

  const layoutClass = count === 2 ? "is-dual" : "is-carousel";
  const items = units
    .map((unit, index) => {
      const normalized = normalizeMarkdownImageUnitHtml(unit.html);
      const caption = resolveMarkdownImageCaption(normalized);
      const captionHtml = caption ? `<figcaption class="mori-image-caption">${escapeHtmlText(caption)}</figcaption>` : "";
      const counterHtml = count > 2 ? `<div class="mori-gallery-counter">${index + 1} / ${count}</div>` : "";
      return `<figure class="mori-image-gallery-item">${counterHtml}${normalized}${captionHtml}</figure>`;
    })
    .join("");

  return `<div class="mori-image-gallery ${layoutClass}" data-image-count="${count}">${items}</div>`;
}

function applyMarkdownImageGalleryLayout(html: string) {
  if (!html || !html.includes("data-mori-markdown-image=\"1\"")) {
    return html;
  }

  MARKDOWN_IMAGE_UNIT_PATTERN.lastIndex = 0;
  const units: MarkdownImageUnit[] = [];
  let match: RegExpExecArray | null = MARKDOWN_IMAGE_UNIT_PATTERN.exec(html);
  while (match) {
    const matchedHtml = match[0];
    const start = typeof match.index === "number" ? match.index : -1;
    if (start >= 0) {
      units.push({
        html: matchedHtml,
        start,
        end: start + matchedHtml.length,
      });
    }

    match = MARKDOWN_IMAGE_UNIT_PATTERN.exec(html);
  }

  if (units.length === 0) {
    return html;
  }

  const replacements: Array<{ start: number; end: number; html: string }> = [];
  let activeGroup: MarkdownImageUnit[] = [];

  const flushActiveGroup = () => {
    if (activeGroup.length === 0) {
      activeGroup = [];
      return;
    }

    const first = activeGroup[0];
    const last = activeGroup[activeGroup.length - 1];
    const replacementHtml =
      activeGroup.length === 1 ? buildMarkdownImageSingle(activeGroup[0]) : buildMarkdownImageGallery(activeGroup);

    replacements.push({
      start: first.start,
      end: last.end,
      html: replacementHtml,
    });
    activeGroup = [];
  };

  units.forEach((unit, index) => {
    if (activeGroup.length === 0) {
      activeGroup = [unit];
      return;
    }

    const previous = units[index - 1];
    const between = html.slice(previous.end, unit.start);
    if (/^\s*$/.test(between)) {
      activeGroup.push(unit);
      return;
    }

    flushActiveGroup();
    activeGroup = [unit];
  });

  flushActiveGroup();

  if (replacements.length === 0) {
    return html;
  }

  let nextHtml = html;
  for (let i = replacements.length - 1; i >= 0; i -= 1) {
    const replacement = replacements[i];
    nextHtml =
      nextHtml.slice(0, replacement.start) +
      replacement.html +
      nextHtml.slice(replacement.end);
  }

  return nextHtml;
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "blockquote",
    "ul",
    "ol",
    "li",
    "code",
    "pre",
    "strong",
    "em",
    "del",
    "ins",
    "mark",
    "span",
    "div",
    "aside",
    "a",
    "img",
    "hr",
    "br",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "sup",
    "sub",
    "details",
    "summary",
    "cite",
    "footer",
    "button",
    "iframe",
    "input",
    "math",
    "semantics",
    "annotation",
    "annotation-xml",
    "mrow",
    "mi",
    "mn",
    "mo",
    "msup",
    "msub",
    "msubsup",
    "mfrac",
    "msqrt",
    "mroot",
    "munder",
    "mover",
    "munderover",
    "mtable",
    "mtr",
    "mtd",
    "mstyle",
    "mspace",
    "mtext",
    "mfenced",
    "menclose",
    "mpadded",
    "mphantom",
    "svg",
    "path",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: [
      "src",
      "data-origin-src",
      "data-origin-srcset",
      "data-origin-sizes",
      "alt",
      "title",
      "width",
      "height",
      "loading",
      "decoding",
      "class",
      "aria-hidden",
      "data-mori-markdown-image",
    ],
    svg: ["class", "viewBox", "width", "height", "aria-hidden", "fill"],
    path: ["d", "fill", "fill-rule", "clip-rule"],
    iframe: [
      "src",
      "title",
      "loading",
      "allow",
      "allowfullscreen",
      "referrerpolicy",
      "sandbox",
      "class",
    ],
    button: [
      "type",
      "class",
      "data-code-b64",
      "data-copy-state",
      "data-tab-index",
      "aria-selected",
      "aria-controls",
      "aria-label",
    ],
    pre: ["class", "style", "tabindex"],
    code: ["class", "style"],
    span: ["class", "style", "aria-hidden"],
    input: ["checked", "disabled", "readonly", "type"],
    math: ["display", "xmlns"],
    annotation: ["encoding"],
    "*": [
      "id",
      "class",
      "data-callout",
      "data-container",
      "data-mori-tabs",
      "data-mori-excalidraw",
      "data-mori-friend-links",
      "data-items",
      "data-tab-index",
      "data-source",
      "aria-hidden",
      "aria-label",
      "aria-controls",
      "aria-labelledby",
      "aria-selected",
      "tabindex",
      "role",
    ],
  },
  parseStyleAttributes: false,
  allowedSchemes: ["http", "https", "mailto", "tel", "data"],
  transformTags: {
    a: (tagName, attribs) => {
      const href = typeof attribs.href === "string" ? attribs.href.trim() : "";
      const isExternal = /^(https?:|mailto:|tel:)/i.test(href);
      const isHashLink = href.startsWith("#");

      if (isHashLink || !isExternal) {
        return {
          tagName,
          attribs,
        };
      }

      return {
        tagName,
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      };
    },
    input: (_tagName, attribs) => {
      const inputAttributes: Record<string, string> = {
        disabled: "disabled",
        readonly: "readonly",
        type: "checkbox",
      };

      if (Object.prototype.hasOwnProperty.call(attribs, "checked")) {
        inputAttributes.checked = "checked";
      }

      return {
        tagName: "input",
        attribs: inputAttributes,
      };
    },
    img: (tagName, attribs) => {
      return {
        tagName,
        attribs: {
          ...attribs,
          loading: attribs.loading ?? "lazy",
          decoding: attribs.decoding ?? "async",
        },
      };
    },
    iframe: (tagName, attribs) => {
      const src = typeof attribs.src === "string" ? attribs.src.trim() : "";
      const safe =
        /^https:\/\/(www\.)?youtube\.com\/embed\//i.test(src) ||
        /^https:\/\/player\.bilibili\.com\/player\.html/i.test(src) ||
        /^https:\/\/codesandbox\.io\/embed\//i.test(src) ||
        /^https:\/\/codesandbox\.io\/p\/devbox\//i.test(src) ||
        /^https:\/\/(www\.)?excalidraw\.com\//i.test(src) ||
        /^https:\/\/app\.excalidraw\.com\//i.test(src);

      if (!safe) {
        return {
          tagName: "div",
          attribs: {},
        };
      }

      return {
        tagName,
        attribs: {
          ...attribs,
          loading: attribs.loading ?? "lazy",
          referrerpolicy: attribs.referrerpolicy ?? "strict-origin-when-cross-origin",
        },
      };
    },
  },
};

export async function prepareArticleContent(rawContent: string | undefined) {
  const htmlSource = await markdownToSafeHtml(rawContent);
  const cleaned = sanitizeHtml(htmlSource, SANITIZE_OPTIONS);
  const withImageGalleries = applyMarkdownImageGalleryLayout(cleaned);

  const tocItems: TocItem[] = [];
  let index = 0;

  const htmlWithHeadingIds = withImageGalleries.replace(
    /<h([1-4])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (_, level, attrs, inner) => {
      index += 1;
      const text = stripHtml(inner);
      const base = slugifyHeading(text);
      const id = `${base}-${index}`;
      const headingLevel = Number(level);

      if (headingLevel >= 1) {
        tocItems.push({
          id,
          text,
          level: headingLevel,
        });
      }

      const attrsWithoutId = String(attrs).replace(/\sid\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "");
      return `<h${level}${attrsWithoutId} id="${id}" data-markdown-heading="true">${inner}<a class="mori-heading-anchor" href="#${id}" aria-label="章节链接">#</a></h${level}>`;
    },
  );

  return {
    html: htmlWithHeadingIds,
    tocItems,
  };
}
