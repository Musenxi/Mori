import "server-only";

import {
  TypechoArchivesResponse,
  TypechoCategory,
  TypechoCommentRaw,
  TypechoCommentsResponse,
  TypechoEnvelope,
  TypechoMeta,
  TypechoPageItem,
  TypechoPagesResponse,
  TypechoPostCounter,
  TypechoPostRaw,
  TypechoPostsResponse,
  TypechoSettings,
} from "./typecho-types";
import { getRedisJson, setRedisJson } from "./redis-client";

const RAW_API_BASE =
  process.env.TYPECHO_API_BASE_URL ?? process.env.NEXT_PUBLIC_TYPECHO_API_BASE_URL ?? "";
const API_BASE = RAW_API_BASE.replace(/\/+$/, "");
const API_TOKEN = process.env.TYPECHO_API_TOKEN ?? "";
const DEFAULT_REVALIDATE = parsePositiveInt(process.env.TYPECHO_REVALIDATE_SECONDS, 90) ?? 90;

function parsePositiveInt(raw: string | undefined, fallback?: number) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

const COMMENT_OWNER_ID = parsePositiveInt(process.env.TYPECHO_COMMENT_OWNER_ID, 1);

export class TypechoClientError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "TypechoClientError";
    this.statusCode = statusCode;
  }
}

export function isTypechoConfigured() {
  return API_BASE.length > 0;
}

function ensureConfigured() {
  if (!isTypechoConfigured()) {
    throw new TypechoClientError(
      "TYPECHO_API_BASE_URL 未配置，请在 .env.local 中设置 Typecho Restful API 地址。",
    );
  }
}

type Primitive = string | number | boolean | null | undefined;

interface RequestTypechoOptions {
  method?: "GET" | "POST";
  query?: Record<string, Primitive>;
  body?: unknown;
  headers?: HeadersInit;
  userAgent?: string;
  revalidate?: number | false;
}

function summarizeNonJsonBody(body: string) {
  const compact = body
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!compact) {
    return "";
  }

  return compact.slice(0, 180);
}

function makeUrl(path: string, query?: Record<string, Primitive>) {
  const normalizedPath = path.replace(/^\/+/, "");
  const url = new URL(`${API_BASE}/${normalizedPath}`);

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === null || value === undefined || value === "") {
        return;
      }
      if (typeof value === "boolean") {
        url.searchParams.set(key, value ? "true" : "false");
        return;
      }
      url.searchParams.set(key, String(value));
    });
  }

  return url.toString();
}

function readSetCookies(headers: Headers) {
  const nodeHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof nodeHeaders.getSetCookie === "function") {
    return nodeHeaders.getSetCookie();
  }

  const fallback = headers.get("set-cookie");
  return fallback ? [fallback] : [];
}

function normalizeRevalidate(revalidate: number | false) {
  if (revalidate === false) {
    return false;
  }

  if (Number.isFinite(revalidate) && revalidate > 0) {
    return Math.floor(revalidate);
  }

  return DEFAULT_REVALIDATE;
}

function makeRedisCacheKey(
  method: "GET" | "POST",
  path: string,
  query?: Record<string, Primitive>,
) {
  const normalizedPath = path.replace(/^\/+/, "");
  const sortedQuery = Object.entries(query ?? {})
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => {
      if (typeof value === "boolean") {
        return [key, value ? "true" : "false"] as const;
      }
      return [key, String(value)] as const;
    })
    .sort(([left], [right]) => left.localeCompare(right));

  const queryString = sortedQuery.map(([key, value]) => `${key}=${value}`).join("&");
  return `typecho:${API_BASE}:${method}:${normalizedPath}?${queryString}`;
}

async function requestTypecho<T>(
  path: string,
  {
    method = "GET",
    query,
    body,
    headers,
    userAgent,
    revalidate = DEFAULT_REVALIDATE,
  }: RequestTypechoOptions = {},
): Promise<T> {
  ensureConfigured();
  const effectiveRevalidate = normalizeRevalidate(revalidate);
  const shouldUseRedis = method === "GET" && effectiveRevalidate !== false;
  const redisCacheKey = shouldUseRedis
    ? makeRedisCacheKey(method, path, query)
    : undefined;

  if (redisCacheKey) {
    const cached = await getRedisJson<T>(redisCacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  const requestHeaders = new Headers(headers);
  requestHeaders.set("Accept", "application/json");

  if (API_TOKEN) {
    requestHeaders.set("token", API_TOKEN);
  }

  if (method === "POST") {
    requestHeaders.set("Content-Type", "application/json");
  }

  if (userAgent) {
    requestHeaders.set("User-Agent", userAgent);
  }

  const response = await fetch(makeUrl(path, query), {
    method,
    headers: requestHeaders,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    cache: effectiveRevalidate === false ? "no-store" : "force-cache",
    ...(effectiveRevalidate === false ? {} : { next: { revalidate: effectiveRevalidate } }),
  });

  const rawText = await response.text();
  let payload: TypechoEnvelope<T> | null = null;

  try {
    payload = JSON.parse(rawText) as TypechoEnvelope<T>;
  } catch {
    const summary = summarizeNonJsonBody(rawText);
    const hint = summary ? `：${summary}` : "";
    throw new TypechoClientError(`Typecho API 返回了非 JSON 响应（HTTP ${response.status}）${hint}`, response.status);
  }

  if (!payload) {
    throw new TypechoClientError("Typecho API 返回了空响应。", response.status);
  }

  if (!response.ok || payload.status !== "success") {
    throw new TypechoClientError(payload.message || `Typecho API 请求失败（HTTP ${response.status}）。`, response.status);
  }

  if (redisCacheKey && effectiveRevalidate !== false) {
    await setRedisJson(redisCacheKey, payload.data, effectiveRevalidate);
  }

  return payload.data;
}

async function requestTypechoWithSetCookie<T>(
  path: string,
  {
    method = "GET",
    query,
    body,
    headers,
    userAgent,
  }: Omit<RequestTypechoOptions, "revalidate"> = {},
): Promise<{ data: T; setCookies: string[] }> {
  ensureConfigured();

  const requestHeaders = new Headers(headers);
  requestHeaders.set("Accept", "application/json");

  if (API_TOKEN) {
    requestHeaders.set("token", API_TOKEN);
  }

  if (method === "POST") {
    requestHeaders.set("Content-Type", "application/json");
  }

  if (userAgent) {
    requestHeaders.set("User-Agent", userAgent);
  }

  const response = await fetch(makeUrl(path, query), {
    method,
    headers: requestHeaders,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    cache: "no-store",
  });

  const rawText = await response.text();
  let payload: TypechoEnvelope<T> | null = null;

  try {
    payload = JSON.parse(rawText) as TypechoEnvelope<T>;
  } catch {
    const summary = summarizeNonJsonBody(rawText);
    const hint = summary ? `：${summary}` : "";
    throw new TypechoClientError(`Typecho API 返回了非 JSON 响应（HTTP ${response.status}）${hint}`, response.status);
  }

  if (!payload) {
    throw new TypechoClientError("Typecho API 返回了空响应。", response.status);
  }

  if (!response.ok || payload.status !== "success") {
    throw new TypechoClientError(payload.message || `Typecho API 请求失败（HTTP ${response.status}）。`, response.status);
  }

  return {
    data: payload.data,
    setCookies: readSetCookies(response.headers),
  };
}

export async function getSettings(): Promise<TypechoSettings> {
  return requestTypecho<TypechoSettings>("settings");
}

export async function getPages(): Promise<TypechoPageItem[]> {
  try {
    const result = await requestTypecho<TypechoPagesResponse>("pages");
    return result.dataSet;
  } catch {
    return [] as TypechoPageItem[];
  }
}

export async function getCategories(): Promise<TypechoCategory[]> {
  try {
    const data = await requestTypecho<unknown>("categories");
    if (Array.isArray(data)) {
      return data as TypechoCategory[];
    }
    return [] as TypechoCategory[];
  } catch {
    return [] as TypechoCategory[];
  }
}

export async function getTags(): Promise<TypechoMeta[]> {
  try {
    const data = await requestTypecho<unknown>("tags");
    if (Array.isArray(data)) {
      return data as TypechoMeta[];
    }
    return [] as TypechoMeta[];
  } catch {
    return [] as TypechoMeta[];
  }
}

interface PostListParams {
  page?: number;
  pageSize?: number;
  filterType?: "category" | "tag" | "search";
  filterSlug?: string;
  showContent?: boolean;
  showDigest?: "more" | "excerpt";
  limit?: number;
  parseMarkdown?: boolean;
  revalidate?: number | false;
}

export async function getPosts(params: PostListParams = {}): Promise<TypechoPostsResponse> {
  return requestTypecho<TypechoPostsResponse>("posts", {
    query: {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 30,
      filterType: params.filterType,
      filterSlug: params.filterSlug,
      showContent: params.showContent,
      showDigest: params.showDigest,
      limit: params.limit,
      parseMarkdown: params.parseMarkdown ?? false,
    },
    revalidate: params.revalidate,
  });
}

interface ArchiveParams {
  showContent?: boolean;
  showDigest?: "more" | "excerpt";
  limit?: number;
  order?: "asc" | "desc";
  parseMarkdown?: boolean;
  revalidate?: number | false;
}

export async function getArchives(params: ArchiveParams = {}): Promise<TypechoArchivesResponse> {
  return requestTypecho<TypechoArchivesResponse>("archives", {
    query: {
      showContent: params.showContent,
      showDigest: params.showDigest,
      limit: params.limit,
      order: params.order ?? "desc",
      parseMarkdown: params.parseMarkdown ?? false,
    },
    revalidate: params.revalidate,
  });
}

export async function getPostBySlug(
  slug: string,
  revalidate: number | false = 60,
): Promise<TypechoPostRaw> {
  return requestTypecho<TypechoPostRaw>("post", {
    query: { slug, parseMarkdown: false },
    revalidate,
  });
}

export async function getPostByCid(
  cid: number,
  revalidate: number | false = 60,
): Promise<TypechoPostRaw> {
  return requestTypecho<TypechoPostRaw>("post", {
    query: { cid, parseMarkdown: false },
    revalidate,
  });
}

interface CommentListParams {
  cid?: number;
  slug?: string;
  page?: number;
  pageSize?: number;
  order?: "asc" | "desc";
  revalidate?: number | false;
}

export async function getComments(params: CommentListParams): Promise<TypechoCommentsResponse> {
  return requestTypecho<TypechoCommentsResponse>("comments", {
    query: {
      cid: params.cid,
      slug: params.slug,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 10,
      order: params.order ?? "asc",
    },
    revalidate: params.revalidate,
  });
}

interface CommentCreateInput {
  cid?: number;
  slug?: string;
  parent?: number;
  author: string;
  mail: string;
  url?: string;
  text: string;
}

export async function createComment(
  input: CommentCreateInput,
  userAgent: string,
): Promise<TypechoCommentRaw> {
  const post = input.cid
    ? await requestTypecho<TypechoPostRaw>("post", {
        query: { cid: input.cid, parseMarkdown: false },
        revalidate: false,
        userAgent,
      })
    : await requestTypecho<TypechoPostRaw>("post", {
        query: { slug: input.slug, parseMarkdown: false },
        revalidate: false,
        userAgent,
      });

  const token = typeof post.csrfToken === "string" ? post.csrfToken : "";
  const resolvedCid = Number(post.cid);

  if (!token) {
    throw new TypechoClientError("未能获取评论 token，请检查 Restful 插件 csrfSalt 设置。", 400);
  }

  if (!Number.isFinite(resolvedCid)) {
    throw new TypechoClientError("未能定位文章 cid，无法提交评论。", 400);
  }

  return requestTypecho<TypechoCommentRaw>("comment", {
    method: "POST",
    body: {
      cid: resolvedCid,
      ownerId: COMMENT_OWNER_ID,
      parent: input.parent,
      author: input.author,
      mail: input.mail,
      url: input.url,
      text: input.text,
      token,
    },
    revalidate: false,
    userAgent,
  });
}

interface PostCounterRequestTarget {
  cid?: number;
  slug?: string;
}

interface PostCounterRequestOptions extends PostCounterRequestTarget {
  cookieHeader?: string;
  userAgent?: string;
}

function buildCounterTarget(target: PostCounterRequestTarget) {
  return {
    cid: Number.isFinite(Number(target.cid)) ? Number(target.cid) : undefined,
    slug: target.slug?.trim() || undefined,
  };
}

export async function getPostCounterStats(
  options: PostCounterRequestOptions,
): Promise<{ data: TypechoPostCounter; setCookies: string[] }> {
  const target = buildCounterTarget(options);
  if (!target.cid && !target.slug) {
    throw new TypechoClientError("缺少文章 cid 或 slug。", 400);
  }

  return requestTypechoWithSetCookie<TypechoPostCounter>("stats", {
    method: "GET",
    query: target,
    headers: options.cookieHeader ? { Cookie: options.cookieHeader } : undefined,
    userAgent: options.userAgent,
  });
}

export async function recordPostView(
  options: PostCounterRequestOptions,
): Promise<{ data: TypechoPostCounter; setCookies: string[] }> {
  const target = buildCounterTarget(options);
  if (!target.cid && !target.slug) {
    throw new TypechoClientError("缺少文章 cid 或 slug。", 400);
  }

  return requestTypechoWithSetCookie<TypechoPostCounter>("view", {
    method: "POST",
    body: target,
    headers: options.cookieHeader ? { Cookie: options.cookieHeader } : undefined,
    userAgent: options.userAgent,
  });
}

export async function recordPostLike(
  options: PostCounterRequestOptions,
): Promise<{ data: TypechoPostCounter; setCookies: string[] }> {
  const target = buildCounterTarget(options);
  if (!target.cid && !target.slug) {
    throw new TypechoClientError("缺少文章 cid 或 slug。", 400);
  }

  return requestTypechoWithSetCookie<TypechoPostCounter>("like", {
    method: "POST",
    body: target,
    headers: options.cookieHeader ? { Cookie: options.cookieHeader } : undefined,
    userAgent: options.userAgent,
  });
}
