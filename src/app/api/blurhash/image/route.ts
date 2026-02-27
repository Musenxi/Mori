import { NextRequest, NextResponse } from "next/server";

import { getBlurhashDataUrlForSource } from "@/lib/blurhash-placeholder";

export const runtime = "nodejs";

const BLURHASH_IMAGE_CACHE_CONTROL = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+P8kAAAAASUVORK5CYII=",
  "base64",
);

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

function toPng(pngBuffer: Buffer) {
  return new NextResponse(pngBuffer, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": BLURHASH_IMAGE_CACHE_CONTROL,
    },
  });
}

function extractPngBufferFromDataUrl(dataUrl: string) {
  const matched = dataUrl.match(/^data:image\/png;base64,(.+)$/i);
  if (!matched?.[1]) {
    return null;
  }

  try {
    return Buffer.from(matched[1], "base64");
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("src")?.trim() || "";
  if (!src) {
    return toPng(TRANSPARENT_PNG);
  }

  const origin = resolveOrigin(request);
  const dataUrl = await getBlurhashDataUrlForSource(src, origin);
  if (!dataUrl) {
    return toPng(TRANSPARENT_PNG);
  }

  const pngBuffer = extractPngBufferFromDataUrl(dataUrl);
  if (!pngBuffer) {
    return toPng(TRANSPARENT_PNG);
  }

  return toPng(pngBuffer);
}
