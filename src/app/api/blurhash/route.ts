import { NextRequest, NextResponse } from "next/server";

import {
  getBlurhashForImage,
  resolveBlurhashSourceUrl,
  validateBlurhashSourceUrl,
} from "@/lib/blurhash-placeholder";

export const runtime = "nodejs";

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

function toJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("src")?.trim() || "";
  if (!src) {
    return toJson(
      {
        ok: false,
        message: "Missing src",
      },
      400,
    );
  }

  const origin = resolveOrigin(request);
  const sourceUrl = resolveBlurhashSourceUrl(src, origin);
  if (!sourceUrl) {
    return toJson(
      {
        ok: false,
        message: "Invalid src",
      },
      400,
    );
  }

  if (!validateBlurhashSourceUrl(sourceUrl, origin)) {
    return toJson(
      {
        ok: false,
        message: "Blocked src host",
      },
      403,
    );
  }

  try {
    const hash = await getBlurhashForImage(sourceUrl);
    return toJson({
      ok: true,
      hash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Blurhash generation failed";
    return toJson(
      {
        ok: false,
        message,
      },
      500,
    );
  }
}
