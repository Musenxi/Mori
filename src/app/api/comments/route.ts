import { NextRequest, NextResponse } from "next/server";

import { createComment, TypechoClientError } from "@/lib/typecho-client";

interface CommentBody {
  slug?: string;
  cid?: number;
  parent?: number;
  author?: string;
  mail?: string;
  url?: string;
  text?: string;
}

function badRequest(message: string) {
  return NextResponse.json(
    {
      ok: false,
      message,
    },
    { status: 400 },
  );
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

    return NextResponse.json({
      ok: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof TypechoClientError ? error.message : "评论提交失败，请稍后重试。";
    const status = error instanceof TypechoClientError && error.statusCode ? error.statusCode : 500;

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status },
    );
  }
}
