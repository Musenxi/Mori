import sanitizeHtml from "sanitize-html";
import { renderSimpleMarkdownToHtml } from "./markdown-render";

import {
  NormalizedComment,
  NormalizedPost,
  TypechoArchivesResponse,
  TypechoCommentRaw,
  TypechoPostRaw,
  YearGroupedPosts,
} from "./typecho-types";

const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

function decodeHtmlEntities(input: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
  };

  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entityRaw: string) => {
    const entity = entityRaw.toLowerCase();

    if (entity.startsWith("#x")) {
      const parsed = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : full;
    }

    if (entity.startsWith("#")) {
      const parsed = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : full;
    }

    return namedEntities[entity] ?? full;
  });
}

function buildGravatarUrl(mailHash?: string) {
  const hash = mailHash?.trim();
  if (!hash) {
    return undefined;
  }

  const prefix = process.env.GRAVATAR_PREFIX?.trim();
  if (!prefix) {
    return undefined;
  }

  if (prefix.includes("{hash}")) {
    return appendGravatarDefault(prefix.replace("{hash}", hash));
  }

  if (prefix.includes("%s")) {
    return appendGravatarDefault(prefix.replace("%s", hash));
  }

  return appendGravatarDefault(injectHash(prefix, hash));
}

export function formatFullDate(tsSeconds: number) {
  return FULL_DATE_FORMATTER.format(new Date(tsSeconds * 1000));
}

export function formatShortDate(tsSeconds: number) {
  const date = new Date(tsSeconds * 1000);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${month}/${day}`;
}

export function stripHtml(html: string | undefined) {
  if (!html) {
    return "";
  }
  const withoutTags = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "");

  return decodeHtmlEntities(withoutTags)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findField(raw: TypechoPostRaw, keys: string[]) {
  const fields = raw.fields ?? {};
  for (const key of keys) {
    const value = fields[key]?.value;
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function appendGravatarDefault(url: string) {
  if (/[?&]d=/.test(url)) {
    return url;
  }

  const needsJoiner = !(url.endsWith("?") || url.endsWith("&"));
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${needsJoiner ? joiner : ""}d=404`;
}

function injectHash(prefix: string, hash: string) {
  const splitIndex = prefix.search(/[?#]/);
  if (splitIndex === -1) {
    const separator = prefix.endsWith("/") || prefix.endsWith("=") ? "" : "/";
    return `${prefix}${separator}${hash}`;
  }

  const base = prefix.slice(0, splitIndex);
  const suffix = prefix.slice(splitIndex);
  const separator = base.endsWith("/") || base.endsWith("=") ? "" : "/";
  return `${base}${separator}${hash}${suffix}`;
}

function extractCoverFromMarkdown(content?: string) {
  if (!content) {
    return "";
  }

  const markdownMatch = content.match(/!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/i);
  return markdownMatch?.[1] || "";
}

function resolveCategory(raw: TypechoPostRaw) {
  const categories = Array.isArray(raw.categories) ? raw.categories : [];
  if (categories.length > 0) {
    const first = categories[0] ?? {};
    const name = typeof first.name === "string" && first.name ? first.name : "未分类";
    const slug = typeof first.slug === "string" ? first.slug : undefined;
    return { name, slug };
  }

  return { name: "未分类", slug: undefined };
}

function resolveSeries(raw: TypechoPostRaw) {
  const value = findField(raw, ["series"]);
  if (!value) {
    return undefined;
  }

  return {
    name: value,
    slug: value,
  };
}

function resolveCommentValue(raw: TypechoPostRaw): 0 | 1 | 2 {
  const value = findField(raw, ["commentvalue"]);
  const parsed = Number.parseInt(value, 10);

  if (parsed === 0 || parsed === 2) {
    return parsed;
  }

  return 1;
}

function resolveTags(raw: TypechoPostRaw) {
  const tags = Array.isArray(raw.tags) ? raw.tags : [];
  return tags
    .map((item) => {
      const name = typeof item.name === "string" ? item.name : "";
      if (!name) {
        return null;
      }
      return {
        name,
        slug: typeof item.slug === "string" ? item.slug : undefined,
      };
    })
    .filter(Boolean) as Array<{ name: string; slug?: string }>;
}

export function normalizePost(raw: TypechoPostRaw): NormalizedPost {
  const created = Number(raw.created ?? 0);
  const category = resolveCategory(raw);
  const series = resolveSeries(raw);
  const commentValue = resolveCommentValue(raw);
  const html = typeof raw.text === "string" ? raw.text : undefined;
  const brief = findField(raw, ["brief"]);
  const excerpt = stripHtml(brief);
  const title = decodeHtmlEntities(typeof raw.title === "string" ? raw.title : "");

  const coverField = findField(raw, [
    "banner",
    "cover",
    "thumbnail",
    "thumb",
    "featured_image",
    "image",
    "img",
  ]);

  return {
    cid: Number(raw.cid),
    slug: raw.slug,
    title,
    permalink: typeof raw.permalink === "string" ? raw.permalink : undefined,
    created,
    createdLabel: formatFullDate(created),
    shortDate: formatShortDate(created),
    commentsNum: Number(raw.commentsNum ?? 0),
    commentValue,
    excerpt,
    html,
    categoryName: category.name,
    categorySlug: category.slug,
    seriesName: series?.name,
    seriesSlug: series?.slug,
    tags: resolveTags(raw),
    coverImage: coverField || extractCoverFromMarkdown(html) || undefined,
  };
}

export function normalizePosts(rawPosts: TypechoPostRaw[]) {
  return rawPosts
    .filter((raw) => findField(raw, ["show"]) !== "0")
    .map(normalizePost)
    .sort((a, b) => b.created - a.created);
}

export function groupPostsByYear(posts: NormalizedPost[]): YearGroupedPosts[] {
  const map = new Map<string, NormalizedPost[]>();

  posts.forEach((post) => {
    const year = `${new Date(post.created * 1000).getFullYear()}`;
    const current = map.get(year) ?? [];
    current.push(post);
    map.set(year, current);
  });

  return [...map.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([year, yearPosts]) => ({
      year,
      posts: yearPosts.sort((a, b) => b.created - a.created),
    }));
}

export function flattenArchives(archives: TypechoArchivesResponse) {
  const flattened: TypechoPostRaw[] = [];

  Object.values(archives.dataSet).forEach((months) => {
    Object.values(months).forEach((posts) => {
      flattened.push(...posts);
    });
  });

  return normalizePosts(flattened);
}

export function normalizeCommentTree(raw: TypechoCommentRaw[], parentAuthor?: string): NormalizedComment[] {
  const sorted = [...raw].sort((a, b) => Number(b.created) - Number(a.created));

  return sorted.map((comment) => {
    const rawMarkdownHtml = renderSimpleMarkdownToHtml(comment.text ?? "");
    const html = sanitizeHtml(rawMarkdownHtml, {
      allowedTags: ["p", "br", "a", "strong", "em", "code", "pre", "blockquote", "ul", "ol", "li", "span", "img", "del", "h1", "h2", "h3", "h4", "h5", "h6", "div", "aside", "sup", "table", "thead", "tbody", "tr", "th", "td"],
      allowedAttributes: {
        a: ["href", "title", "target", "rel", "class"],
        span: ["class", "style"],
        code: ["class"],
        pre: ["class", "data-mori-code", "data-lang", "data-attrs"],
        img: ["src", "alt", "title", "class"],
        p: ["class"],
        div: ["class", "data-container"],
        aside: ["class", "data-callout"],
        sup: ["id", "class"],
      },
      transformTags: {
        a: sanitizeHtml.simpleTransform("a", {
          target: "_blank",
          rel: "noopener noreferrer",
        }),
      },
    });

    return {
      coid: Number(comment.coid),
      parent: Number(comment.parent),
      author: comment.author,
      replyTo: parentAuthor,
      initial: comment.author?.slice(0, 1).toUpperCase() || "?",
      url: comment.url,
      created: Number(comment.created),
      createdLabel: formatFullDate(Number(comment.created)),
      html,
      mailHash: comment.mailHash,
      avatarUrl: buildGravatarUrl(comment.mailHash),
      children: normalizeCommentTree(comment.children ?? [], comment.author),
    };
  });
}

export function limitCommentDepth(comments: NormalizedComment[], maxDepth = 2): NormalizedComment[] {
  const normalizeLevel = (nodes: NormalizedComment[], depth: number): NormalizedComment[] => {
    return nodes.flatMap((node) => {
      const nextChildren = normalizeLevel(node.children ?? [], depth + 1);

      if (depth >= maxDepth) {
        // Keep the current node on max depth and promote deeper descendants
        // as parallel siblings of this level.
        return [{ ...node, children: [] }, ...nextChildren];
      }

      return [{ ...node, children: nextChildren }];
    });
  };

  return normalizeLevel(comments, 0);
}
