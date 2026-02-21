import { NextRequest, NextResponse } from "next/server";

import { getCategoryData } from "@/lib/site-data";

function toNoStoreJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug")?.trim() || null;

  try {
    const data = await getCategoryData(slug);
    return toNoStoreJson({
      ok: true,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "分类数据加载失败。";
    return toNoStoreJson(
      {
        ok: false,
        message,
      },
      500,
    );
  }
}
