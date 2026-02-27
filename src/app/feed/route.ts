import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { prepareArticleContent } from "@/lib/article-content";
import { toNextImageProxySrc } from "@/lib/image-url";
import { getHomeData } from "@/lib/site-data";
import { stripHtml } from "@/lib/typecho-normalize";
import { getSettings } from "@/lib/typecho-client";
import { NormalizedPost } from "@/lib/typecho-types";

export const runtime = "nodejs";

const FEED_LIMIT = 50;

function normalizeText(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapCdata(content: string) {
  return content.replace(/]]>/g, "]]]]><![CDATA[>");
}

const ABSOLUTE_SCHEME_REGEX = /^[a-z][a-z0-9+.-]*:/i;

function resolveOrigin(request: NextRequest) {
  try {
    const originUrl = new URL(request.nextUrl.origin);
    if (originUrl.hostname === "0.0.0.0" || originUrl.hostname === "::") {
      originUrl.hostname = "127.0.0.1";
    }
    return originUrl.origin;
  } catch {
    return "http://127.0.0.1:3000";
  }
}

function toAbsoluteUrl(value: string, origin: string) {
  const raw = value.trim();
  if (!raw) {
    return "";
  }

  if (raw.startsWith("#")) {
    return raw;
  }

  if (ABSOLUTE_SCHEME_REGEX.test(raw)) {
    return raw;
  }

  if (raw.startsWith("//")) {
    return `${origin.startsWith("https://") ? "https:" : "http:"}${raw}`;
  }

  if (raw.startsWith("/")) {
    return `${origin}${raw}`;
  }

  try {
    return new URL(raw, `${origin}/`).toString();
  } catch {
    return raw;
  }
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getTagAttr(tag: string, name: string) {
  const pattern = new RegExp(`\\b${escapeRegex(name)}=(["'])([\\s\\S]*?)\\1`, "i");
  const match = tag.match(pattern);
  return match?.[2]?.trim() || "";
}

function setTagAttr(tag: string, name: string, value: string) {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return tag;
  }

  const escapedValue = normalizedValue.replace(/"/g, "&quot;");
  const pattern = new RegExp(`\\b${escapeRegex(name)}=(["'])[\\s\\S]*?\\1`, "i");
  if (pattern.test(tag)) {
    return tag.replace(pattern, `${name}="${escapedValue}"`);
  }

  return tag.replace(/\s*\/?>$/, (ending) => ` ${name}="${escapedValue}"${ending}`);
}

function removeTagAttr(tag: string, name: string) {
  const pattern = new RegExp(`\\s+${escapeRegex(name)}=(["'])[\\s\\S]*?\\1`, "gi");
  return tag.replace(pattern, "");
}

function unwrapNextImageUrl(value: string, origin: string) {
  const absolute = toAbsoluteUrl(value, origin);
  if (!absolute) {
    return "";
  }

  try {
    const parsed = new URL(absolute);
    if (parsed.pathname !== "/_next/image") {
      return absolute;
    }

    const target = parsed.searchParams.get("url")?.trim() || "";
    if (!target) {
      return absolute;
    }

    return toAbsoluteUrl(target, `${parsed.protocol}//${parsed.host}`);
  } catch {
    return absolute;
  }
}

function toCompressedImageUrl(value: string, origin: string) {
  const original = unwrapNextImageUrl(value, origin);
  if (!original) {
    return "";
  }

  if (original.startsWith("data:")) {
    return original;
  }

  const proxied = toNextImageProxySrc(original, { width: 1600, quality: 85 });
  return toAbsoluteUrl(proxied, origin);
}

function normalizeImgTag(tag: string, origin: string) {
  const originSrc = getTagAttr(tag, "data-origin-src");
  const currentSrc = getTagAttr(tag, "src");
  const targetSrc = originSrc || currentSrc;

  let normalized = tag;
  if (targetSrc) {
    normalized = setTagAttr(normalized, "src", toCompressedImageUrl(targetSrc, origin));
  }

  normalized = removeTagAttr(normalized, "srcset");
  normalized = removeTagAttr(normalized, "sizes");
  normalized = removeTagAttr(normalized, "data-origin-src");
  normalized = removeTagAttr(normalized, "data-origin-srcset");
  normalized = removeTagAttr(normalized, "data-origin-sizes");
  return normalized;
}

function absolutizeHtmlUrls(html: string, origin: string) {
  const normalizedImages = html.replace(/<img\b[^>]*>/gi, (tag) => {
    return normalizeImgTag(tag, origin);
  });

  return normalizedImages.replace(/\b(src|href|poster)=(["'])([\s\S]*?)\2/gi, (_full, attr: string, quote: string, value: string) => {
    const nextValue = toAbsoluteUrl(value, origin);
    return `${attr}=${quote}${nextValue}${quote}`;
  });
}

function extractFirstImageFromHtml(html: string) {
  const match = html.match(/<img\b[^>]*\bsrc=(["'])(.*?)\1/i);
  return match?.[2]?.trim() || "";
}

function detectMimeTypeFromPath(pathname: string) {
  const normalized = pathname.toLowerCase();
  if (normalized.endsWith(".avif")) {
    return "image/avif";
  }
  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }
  if (normalized.endsWith(".png")) {
    return "image/png";
  }
  if (normalized.endsWith(".gif")) {
    return "image/gif";
  }
  if (normalized.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (normalized.endsWith(".bmp")) {
    return "image/bmp";
  }
  if (normalized.endsWith(".ico")) {
    return "image/x-icon";
  }
  if (normalized.endsWith(".heic")) {
    return "image/heic";
  }
  if (normalized.endsWith(".heif")) {
    return "image/heif";
  }
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg") || normalized.endsWith(".jfif")) {
    return "image/jpeg";
  }

  return "";
}

function resolveEnclosureMimeType(url: string) {
  try {
    const parsed = new URL(url);
    const direct = detectMimeTypeFromPath(parsed.pathname);
    if (direct) {
      return direct;
    }

    if (parsed.pathname === "/_next/image") {
      const target = parsed.searchParams.get("url")?.trim() || "";
      if (!target) {
        return "image/jpeg";
      }
      const nextTarget = toAbsoluteUrl(target, `${parsed.protocol}//${parsed.host}`);
      return resolveEnclosureMimeType(nextTarget);
    }
  } catch {
    // Ignore parse errors and fallback below.
  }

  return "image/jpeg";
}

function buildEnclosureXml(post: NormalizedPost, renderedContent: string, origin: string) {
  const cover = post.coverImage?.trim() || "";
  const firstImage = extractFirstImageFromHtml(renderedContent);
  const rawUrl = cover || firstImage;
  if (!rawUrl) {
    return "";
  }

  const absoluteUrl = toCompressedImageUrl(rawUrl, origin);
  if (!absoluteUrl || absoluteUrl.startsWith("data:")) {
    return "";
  }

  const type = resolveEnclosureMimeType(absoluteUrl);
  return `<enclosure url="${escapeXml(absoluteUrl)}" length="0" type="${escapeXml(type)}" />`;
}

function resolvePostLink(post: NormalizedPost, origin: string) {
  const redirect = post.redirect?.trim();
  if (redirect) {
    try {
      return new URL(redirect, `${origin}/`).toString();
    } catch {
      // Fall through to default route when redirect is invalid.
    }
  }

  const slug = post.slug.trim();
  return `${origin}/post/${encodeURIComponent(slug)}`;
}

function buildPostDescription(post: NormalizedPost, renderedContent?: string) {
  if (typeof renderedContent === "string" && renderedContent.trim()) {
    return stripHtml(renderedContent).slice(0, 220);
  }

  const excerpt = post.excerpt.trim();
  if (excerpt) {
    return excerpt;
  }

  if (typeof post.html === "string" && post.html.trim()) {
    return stripHtml(post.html).slice(0, 220);
  }

  return "";
}

function buildGuidUuid(post: NormalizedPost) {
  const seed = `mori-feed:${post.cid}:${post.slug}:${post.created}`;
  const hash = createHash("sha1").update(seed).digest("hex").slice(0, 32).split("");

  hash[12] = "5";
  hash[16] = ((Number.parseInt(hash[16] ?? "0", 16) & 0x3) | 0x8).toString(16);

  const hex = hash.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function buildRenderedContent(post: NormalizedPost) {
  const raw = post.html?.trim() || "";
  if (!raw) {
    return "";
  }

  try {
    const prepared = await prepareArticleContent(raw);
    return prepared.html.trim();
  } catch {
    return "";
  }
}

async function buildItemXml(post: NormalizedPost, origin: string) {
  const link = resolvePostLink(post, origin);
  const guid = buildGuidUuid(post);
  const title = post.title.trim() || "未命名文章";
  const renderedContent = await buildRenderedContent(post);
  const description = buildPostDescription(post, renderedContent);
  const pubDate = new Date(post.created * 1000).toUTCString();
  const content = (renderedContent ? absolutizeHtmlUrls(renderedContent, origin) : description).trim();
  const enclosure = buildEnclosureXml(post, content, origin);
  const categories = [post.categoryName, ...post.tags.map((tag) => tag.name)]
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => `<category>${escapeXml(value)}</category>`)
    .join("");

  return `
    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(guid)}</guid>
      <pubDate>${escapeXml(pubDate)}</pubDate>
      <description>${escapeXml(description)}</description>
      <content:encoded><![CDATA[${wrapCdata(content)}]]></content:encoded>
      ${enclosure}
      ${categories}
    </item>`;
}

async function buildFeedXml(
  posts: NormalizedPost[],
  {
    title,
    description,
    origin,
  }: {
    title: string;
    description: string;
    origin: string;
  },
) {
  const channelLink = `${origin}/`;
  const feedLink = `${origin}/feed`;
  const itemList = await Promise.all(posts.map((post) => buildItemXml(post, origin)));
  const items = itemList.join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(channelLink)}</link>
    <description>${escapeXml(description)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${escapeXml(new Date().toUTCString())}</lastBuildDate>
    <atom:link href="${escapeXml(feedLink)}" rel="self" type="application/rss+xml" />
    ${items}
  </channel>
</rss>
`;
}

function toXmlResponse(xml: string, status = 200) {
  return new NextResponse(xml, {
    status,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const [settings, homeData] = await Promise.all([getSettings(), getHomeData()]);
    const origin = resolveOrigin(request);
    const title = normalizeText(settings.title, "夜庭記");
    const description = normalizeText(settings.description, "静观其变，慢写人间。");
    const posts = homeData.allPosts.slice(0, FEED_LIMIT);

    const xml = await buildFeedXml(posts, {
      title,
      description,
      origin,
    });
    return toXmlResponse(xml);
  } catch (error) {
    const origin = resolveOrigin(request);
    const message = error instanceof Error ? error.message : "生成 RSS 失败。";

    const xml = await buildFeedXml([], {
      title: "夜庭記",
      description: `RSS 生成失败：${message}`,
      origin,
    });
    return toXmlResponse(xml, 503);
  }
}
