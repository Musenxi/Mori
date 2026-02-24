import { NextRequest, NextResponse } from "next/server";

import { getColumnDetailData } from "@/lib/site-data";

function toJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
    },
  });
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug")?.trim() || "";
  if (!slug) {
    return toJson(
      {
        ok: false,
        message: "缺少专栏 slug。",
      },
      400,
    );
  }

  try {
    const data = await getColumnDetailData(slug);
    return toJson({
      ok: true,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "专栏数据加载失败。";
    return toJson(
      {
        ok: false,
        message,
      },
      500,
    );
  }
}
