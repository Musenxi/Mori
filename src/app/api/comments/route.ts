import { NextRequest, NextResponse } from "next/server";

import {
  createComment,
  getComments,
  getUserByUid,
  TypechoClientError,
} from "@/lib/typecho-client";
import { limitCommentDepth, normalizeCommentTree } from "@/lib/typecho-normalize";

interface CommentBody {
  slug?: string;
  cid?: number;
  parent?: number;
  author?: string;
  mail?: string;
  url?: string;
  text?: string;
}

const COMMENT_CACHE_SECONDS = 5;
const OWNER_UID_FOR_RESERVED_NICKNAME = 1;
const OWNER_NAME_CACHE_SECONDS = parsePositiveInt(process.env.TYPECHO_OWNER_REVALIDATE_SECONDS, 600);
const READ_CACHE_CONTROL = `public, max-age=${COMMENT_CACHE_SECONDS}, stale-while-revalidate=${COMMENT_CACHE_SECONDS * 4}`;

function toNoStoreJson(data: unknown, status = 200) {
  return NextResponse.json(
    data,
    {
      status,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    },
  );
}

function toReadCachedJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": READ_CACHE_CONTROL,
    },
  });
}

function badRequest(message: string) {
  return toNoStoreJson(
    {
      ok: false,
      message,
    },
    400,
  );
}

function parsePositiveInt(raw: string | null | undefined, fallback: number) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNickname(raw: string) {
  return raw.trim().toLocaleLowerCase();
}

async function getReservedNickname() {
  const owner = await getUserByUid(OWNER_UID_FOR_RESERVED_NICKNAME, OWNER_NAME_CACHE_SECONDS);
  if (!owner || typeof owner.name !== "string") {
    return "";
  }

  return owner.name.trim();
}

function normalizeClientIp(raw: string | null | undefined) {
  if (!raw) {
    return "";
  }

  let value = raw.trim();
  if (!value) {
    return "";
  }

  if (value.includes(",")) {
    value = value.split(",")[0]?.trim() ?? "";
  }

  if (value.toLowerCase().startsWith("for=")) {
    value = value.slice(4).trim();
  }

  value = value.replace(/^["']|["']$/g, "");

  if (value.startsWith("[") && value.includes("]")) {
    value = value.slice(1, value.indexOf("]")).trim();
  } else {
    const ipv4WithPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (ipv4WithPort?.[1]) {
      value = ipv4WithPort[1];
    }
  }

  if (!value || value.toLowerCase() === "unknown") {
    return "";
  }

  return value.slice(0, 128);
}

function resolveClientIp(request: NextRequest) {
  const forwarded = request.headers.get("forwarded");
  if (forwarded) {
    const firstPart = forwarded.split(",")[0] ?? forwarded;
    const forMatch = firstPart.match(/for=(?:"?\[?)([^;\],"]+)/i);
    const forwardedIp = normalizeClientIp(forMatch?.[1] ?? "");
    if (forwardedIp) {
      return forwardedIp;
    }
  }

  const headerNames = [
    "x-typecho-restful-ip",
    "cf-connecting-ip",
    "x-forwarded-for",
    "x-real-ip",
    "x-client-ip",
    "x-vercel-forwarded-for",
    "true-client-ip",
    "fastly-client-ip",
  ];

  for (const headerName of headerNames) {
    const normalized = normalizeClientIp(request.headers.get(headerName));
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug")?.trim() ?? "";
  const cidRaw = request.nextUrl.searchParams.get("cid");
  const cid = parsePositiveInt(cidRaw, Number.NaN);
  const page = parsePositiveInt(request.nextUrl.searchParams.get("page"), 1);
  const pageSize = parsePositiveInt(request.nextUrl.searchParams.get("pageSize"), 10);
  const freshRaw = request.nextUrl.searchParams.get("fresh")?.trim().toLowerCase();
  const fresh = freshRaw === "1" || freshRaw === "true" || freshRaw === "yes";

  if (!slug && !Number.isFinite(cid)) {
    return badRequest("缺少文章 slug 或 cid。");
  }

  try {
    const response = await getComments({
      slug: slug || undefined,
      cid: Number.isFinite(cid) ? cid : undefined,
      page,
      pageSize,
      order: "desc",
      revalidate: fresh ? false : COMMENT_CACHE_SECONDS,
    });
    const payload = {
      ok: true,
      data: {
        comments: limitCommentDepth(normalizeCommentTree(response.dataSet), 2),
        pagination: {
          page: response.page,
          pageSize: response.pageSize,
          pages: response.pages,
          count: response.count,
        },
      },
    };

    if (fresh) {
      return toNoStoreJson(payload);
    }

    return toReadCachedJson(
      {
        ...payload,
      },
    );
  } catch (error) {
    const message = error instanceof TypechoClientError ? error.message : "评论加载失败，请稍后重试。";
    const status = error instanceof TypechoClientError && error.statusCode ? error.statusCode : 500;

    return toNoStoreJson(
      {
        ok: false,
        message,
      },
      status,
    );
  }
}

export async function POST(request: NextRequest) {
  let payload: CommentBody;

  try {
    payload = (await request.json()) as CommentBody;
  } catch {
    return badRequest("请求体必须是 JSON。");
  }

  const author = payload.author?.trim() ?? "";
  const mail = payload.mail?.trim() ?? "";
  const text = payload.text?.trim() ?? "";
  const url = payload.url?.trim() ?? "";
  const slug = payload.slug?.trim() ?? "";
  const cid = Number(payload.cid);

  if (!author) {
    return badRequest("昵称不能为空。");
  }

  if (!mail) {
    return badRequest("邮箱不能为空。");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    return badRequest("邮箱格式不正确。");
  }

  if (!text) {
    return badRequest("评论内容不能为空。");
  }

  const reservedNickname = await getReservedNickname();
  if (reservedNickname && normalizeNickname(author) === normalizeNickname(reservedNickname)) {
    return badRequest(`昵称“${reservedNickname}”为站点保留名称，请更换后再提交。`);
  }

  if (!slug && !Number.isFinite(cid)) {
    return badRequest("缺少文章 slug 或 cid。");
  }

  try {
    const clientIp = resolveClientIp(request);
    const result = await createComment(
      {
        slug: slug || undefined,
        cid: Number.isFinite(cid) ? cid : undefined,
        parent: Number.isFinite(Number(payload.parent)) ? Number(payload.parent) : undefined,
        author,
        mail,
        url: url || undefined,
        text,
      },
      request.headers.get("user-agent") ?? "Mori-Frontend/1.0",
      {
        clientIp,
      },
    );

    return toNoStoreJson(
      {
        ok: true,
        data: result,
      },
    );
  } catch (error) {
    const message = error instanceof TypechoClientError ? error.message : "评论提交失败，请稍后重试。";
    const status = error instanceof TypechoClientError && error.statusCode ? error.statusCode : 500;

    return toNoStoreJson(
      {
        ok: false,
        message,
      },
      status,
    );
  }
}
