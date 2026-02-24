import { NextRequest, NextResponse } from "next/server";

import { getCategoryData } from "@/lib/site-data";

function toJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
    },
  });
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug")?.trim() || null;

  try {
    const data = await getCategoryData(slug);
    return toJson({
      ok: true,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "分类数据加载失败。";
    return toJson(
      {
        ok: false,
        message,
      },
      500,
    );
  }
}
