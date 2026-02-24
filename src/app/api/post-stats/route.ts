import { NextRequest, NextResponse } from "next/server";

import {
  getPostCounterStats,
  recordPostLike,
  recordPostView,
  TypechoClientError,
} from "@/lib/typecho-client";
import { PostCounterRealtimePayload, TypechoPostCounter } from "@/lib/typecho-types";

export const runtime = "nodejs";

interface PostStatsBody {
  action?: "view" | "like";
  cid?: number;
  slug?: string;
}

const POST_COUNTER_UPDATED_EVENT = "post:counter-updated";

function getSocketInternalToken() {
  const token = process.env["SOCKET_INTERNAL_TOKEN"];
  if (typeof token === "string" && token.trim()) {
    return token.trim();
  }
  return "mori-local-socket-token";
}

function normalizeNonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function normalizeSlug(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toRealtimePayload(counter: TypechoPostCounter): PostCounterRealtimePayload {
  return {
    cid: normalizeNonNegativeInteger(counter.cid),
    slug: normalizeSlug(counter.slug),
    viewsNum: normalizeNonNegativeInteger(counter.viewsNum),
    likesNum: normalizeNonNegativeInteger(counter.likesNum),
  };
}

function resolveBroadcastOrigin(request: NextRequest) {
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

async function emitCounterUpdate(request: NextRequest, counter: TypechoPostCounter) {
  const payload = toRealtimePayload(counter);
  if (payload.cid <= 0) {
    return;
  }

  const rooms = [`post:${payload.cid}`];
  if (payload.slug) {
    rooms.push(`post:slug:${payload.slug}`);
  }

  try {
    const bridgeResponse = await fetch(`${resolveBroadcastOrigin(request)}/internal/socket-broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mori-socket-token": getSocketInternalToken(),
      },
      cache: "no-store",
      body: JSON.stringify({
        event: POST_COUNTER_UPDATED_EVENT,
        rooms,
        payload,
      }),
    });
    if (!bridgeResponse.ok) {
      console.warn(`[socket-broadcast] bridge request failed with status ${bridgeResponse.status}`);
    }
  } catch {
    console.warn("[socket-broadcast] bridge request failed");
  }
}

function toJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
    },
  });
}

function parseCid(raw: string | null | undefined) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function appendSetCookies(response: NextResponse, cookies: string[]) {
  cookies.forEach((cookie) => {
    if (!cookie || !cookie.trim()) {
      return;
    }
    response.headers.append("Set-Cookie", cookie);
  });
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug")?.trim() || undefined;
  const cid = parseCid(request.nextUrl.searchParams.get("cid"));

  if (!slug && !cid) {
    return toJson(
      {
        ok: false,
        message: "缺少文章 slug 或 cid。",
      },
      400,
    );
  }

  try {
    const result = await getPostCounterStats({
      cid,
      slug,
      cookieHeader: request.headers.get("cookie") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? "Mori-Frontend/1.0",
    });

    const response = toJson({
      ok: true,
      data: result.data,
    });
    appendSetCookies(response, result.setCookies);
    return response;
  } catch (error) {
    const message = error instanceof TypechoClientError ? error.message : "文章统计加载失败。";
    const status = error instanceof TypechoClientError && error.statusCode ? error.statusCode : 500;
    return toJson(
      {
        ok: false,
        message,
      },
      status,
    );
  }
}

export async function POST(request: NextRequest) {
  let payload: PostStatsBody;

  try {
    payload = (await request.json()) as PostStatsBody;
  } catch {
    return toJson(
      {
        ok: false,
        message: "请求体必须是 JSON。",
      },
      400,
    );
  }

  const slug = payload.slug?.trim() || undefined;
  const cidParsed = Number.parseInt(String(payload.cid ?? ""), 10);
  const cid = Number.isFinite(cidParsed) && cidParsed > 0 ? cidParsed : undefined;
  const action = payload.action;

  if (!slug && !cid) {
    return toJson(
      {
        ok: false,
        message: "缺少文章 slug 或 cid。",
      },
      400,
    );
  }

  if (action !== "view" && action !== "like") {
    return toJson(
      {
        ok: false,
        message: "action 仅支持 view 或 like。",
      },
      400,
    );
  }

  try {
    const result =
      action === "view"
        ? await recordPostView({
            cid,
            slug,
            cookieHeader: request.headers.get("cookie") ?? undefined,
            userAgent: request.headers.get("user-agent") ?? "Mori-Frontend/1.0",
          })
        : await recordPostLike({
            cid,
            slug,
            cookieHeader: request.headers.get("cookie") ?? undefined,
            userAgent: request.headers.get("user-agent") ?? "Mori-Frontend/1.0",
          });

    const response = toJson({
      ok: true,
      data: result.data,
    });
    if (result.data.counted !== false) {
      await emitCounterUpdate(request, result.data);
    }
    appendSetCookies(response, result.setCookies);
    return response;
  } catch (error) {
    const message = error instanceof TypechoClientError ? error.message : "文章统计更新失败。";
    const status = error instanceof TypechoClientError && error.statusCode ? error.statusCode : 500;
    return toJson(
      {
        ok: false,
        message,
      },
      status,
    );
  }
}
