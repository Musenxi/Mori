import sanitizeHtml from "sanitize-html";

import { toNextImageProxySrc } from "./image-url";
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
      "alt",
      "title",
      "width",
      "height",
      "loading",
      "decoding",
      "class",
      "aria-hidden",
      "data-origin-src",
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
      const source = typeof attribs.src === "string" ? attribs.src.trim() : "";
      const className = typeof attribs.class === "string" ? attribs.class : "";
      const isOwo = /\bmori-owo\b/.test(className);
      const markdownImageFlag =
        typeof attribs["data-mori-markdown-image"] === "string"
          ? attribs["data-mori-markdown-image"].trim()
          : "";
      const isMarkdownImage = markdownImageFlag === "1" || markdownImageFlag.toLowerCase() === "true";
      const optimizedSource = isMarkdownImage && !isOwo ? toNextImageProxySrc(source) : "";
      const sanitizedAttribs = { ...attribs };
      delete sanitizedAttribs.srcset;
      delete sanitizedAttribs.sizes;
      delete sanitizedAttribs["data-origin-srcset"];
      delete sanitizedAttribs["data-origin-sizes"];

      return {
        tagName,
        attribs: {
          ...sanitizedAttribs,
          src: optimizedSource || source,
          loading: attribs.loading ?? "lazy",
          decoding: attribs.decoding ?? "async",
          ...(optimizedSource && source && optimizedSource !== source
            ? { "data-origin-src": source }
            : {}),
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

  const tocItems: TocItem[] = [];
  let index = 0;

  const htmlWithHeadingIds = cleaned.replace(/<h([1-4])([^>]*)>([\s\S]*?)<\/h\1>/gi, (_, level, attrs, inner) => {
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
  });

  return {
    html: htmlWithHeadingIds,
    tocItems,
  };
}
