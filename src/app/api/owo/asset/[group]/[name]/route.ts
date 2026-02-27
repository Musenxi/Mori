import { existsSync } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import { getOwoAssetCandidates } from "@/lib/owo";

const OWO_ROOT = path.join(process.cwd(), "public", "owo");
const REDIRECT_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

type RouteContext = {
  params: Promise<{ group: string; name: string }> | { group: string; name: string };
};

function resolveExistingAssetPath(group: string, name: string) {
  const candidates = getOwoAssetCandidates(group, name);

  for (const relativePath of candidates) {
    const absolutePath = path.join(OWO_ROOT, relativePath);
    if (existsSync(absolutePath)) {
      return relativePath;
    }
  }

  return "";
}

export async function GET(request: NextRequest, context: RouteContext) {
  const params = await Promise.resolve(context.params);
  const relativePath = resolveExistingAssetPath(params.group, params.name);

  if (!relativePath) {
    return new NextResponse(null, {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  const location = new URL(`/owo/${relativePath}`, request.url);
  return NextResponse.redirect(location, {
    status: 307,
    headers: {
      "Cache-Control": REDIRECT_CACHE_CONTROL,
    },
  });
}
