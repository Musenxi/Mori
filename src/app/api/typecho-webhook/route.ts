import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

import { deleteRedisByPattern } from "@/lib/redis-client";
import { getPostByCid } from "@/lib/typecho-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TypechoWebhookPayload {
  event?: string;
  timestamp?: number;
  source?: string;
  site?: {
    title?: string;
    url?: string;
  };
  payload?: Record<string, unknown> | null;
}

const STATIC_PAGE_SLUGS = new Set(["about", "friends", "comment"]);

function toJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parsePositiveInt(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getWebhookToken() {
  const token = process.env.TYPECHO_WEBHOOK_TOKEN ?? process.env.MORI_WEBHOOK_TOKEN ?? "";
  return typeof token === "string" ? token.trim() : "";
}

function getIncomingToken(request: NextRequest) {
  const headerToken = normalizeText(request.headers.get("x-mori-webhook-token"));
  if (headerToken) {
    return headerToken;
  }

  const authorization = normalizeText(request.headers.get("authorization"));
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return "";
}

async function resolveSlug(payload: Record<string, unknown> | null | undefined) {
  const direct = normalizeText(payload?.slug);
  if (direct) {
    return direct;
  }

  const cid = parsePositiveInt(payload?.cid);
  if (!cid) {
    return "";
  }

  try {
    const post = await getPostByCid(cid, false);
    return normalizeText(post?.slug);
  } catch {
    return "";
  }
}

function collectPaths(paths: Set<string>, items: string[]) {
  items.forEach((item) => {
    const normalized = normalizeText(item);
    if (normalized) {
      paths.add(normalized);
    }
  });
}

function safeRevalidatePath(path: string, type?: "layout" | "page") {
  try {
    revalidatePath(path, type);
    return true;
  } catch (error) {
    console.warn(`[typecho-webhook] revalidatePath failed for ${path}:`, error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  const expectedToken = getWebhookToken();
  if (expectedToken) {
    const incoming = getIncomingToken(request);
    if (!incoming || incoming !== expectedToken) {
      return toJson(
        {
          ok: false,
          message: "Webhook token 校验失败。",
        },
        401,
      );
    }
  }

  let body: TypechoWebhookPayload;
  try {
    body = (await request.json()) as TypechoWebhookPayload;
  } catch {
    return toJson(
      {
        ok: false,
        message: "请求体必须是 JSON。",
      },
      400,
    );
  }

  const event = normalizeText(body.event).toLowerCase();
  if (!event) {
    return toJson(
      {
        ok: false,
        message: "缺少 event 字段。",
      },
      400,
    );
  }

  const group = event.split(".")[0] || "unknown";
  const payload = body.payload && typeof body.payload === "object" ? body.payload : null;
  const slug = group === "meta" || group === "settings" ? "" : await resolveSlug(payload);
  const contentType = normalizeText(payload?.type);
  const shouldRevalidateRootLayout = group === "settings" || contentType === "page";

  const paths = new Set<string>();

  if (group === "settings") {
    collectPaths(paths, ["/", "/category", "/column", "/feed", "/about", "/friends", "/comment"]);
  } else if (group === "meta") {
    collectPaths(paths, ["/", "/category", "/column", "/feed"]);
  } else if (group === "comment") {
    collectPaths(paths, ["/comment"]);
  } else {
    collectPaths(paths, ["/", "/category", "/column", "/feed"]);
  }

  if (slug) {
    if (contentType === "page") {
      if (STATIC_PAGE_SLUGS.has(slug)) {
        paths.add(`/${slug}`);
      } else {
        paths.add(`/page/${slug}`);
      }
    } else {
      paths.add(`/post/${slug}`);
    }
  }

  const deletedKeys = await deleteRedisByPattern("typecho:*");
  try {
    revalidateTag("site-context", "max");
  } catch (error) {
    console.warn("[typecho-webhook] revalidateTag failed for site-context:", error);
  }
  const revalidated: string[] = [];
  if (shouldRevalidateRootLayout && safeRevalidatePath("/", "layout")) {
    revalidated.push("/:layout");
  }
  paths.forEach((path) => {
    if (safeRevalidatePath(path)) {
      revalidated.push(path);
    }
  });

  return toJson({
    ok: true,
    event,
    group,
    slug: slug || null,
    revalidated,
    redisDeleted: deletedKeys,
  });
}

export async function GET() {
  return toJson(
    {
      ok: false,
      message: "Method Not Allowed",
    },
    405,
  );
}
