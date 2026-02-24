import { NextRequest, NextResponse } from "next/server";

import { createComment, getComments, TypechoClientError } from "@/lib/typecho-client";
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

const READ_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=120";

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

function parsePositiveInt(raw: string | null, fallback: number) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug")?.trim() ?? "";
  const cidRaw = request.nextUrl.searchParams.get("cid");
  const cid = parsePositiveInt(cidRaw, Number.NaN);
  const page = parsePositiveInt(request.nextUrl.searchParams.get("page"), 1);
  const pageSize = parsePositiveInt(request.nextUrl.searchParams.get("pageSize"), 10);

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
      revalidate: 30,
    });

    return toReadCachedJson(
      {
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

  if (!slug && !Number.isFinite(cid)) {
    return badRequest("缺少文章 slug 或 cid。");
  }

  try {
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
