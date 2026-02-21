import { NextRequest, NextResponse } from "next/server";

import { getColumnDetailData } from "@/lib/site-data";

function toNoStoreJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug")?.trim() || "";
  if (!slug) {
    return toNoStoreJson(
      {
        ok: false,
        message: "缺少专栏 slug。",
      },
      400,
    );
  }

  try {
    const data = await getColumnDetailData(slug);
    return toNoStoreJson({
      ok: true,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "专栏数据加载失败。";
    return toNoStoreJson(
      {
        ok: false,
        message,
      },
      500,
    );
  }
}
