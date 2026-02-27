import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";

import { decode, encode } from "blurhash";
import sharp from "sharp";

import { getRedisJson, setRedisJsonPersistent } from "@/lib/redis-client";

const BLURHASH_COMPONENT_X = 4;
const BLURHASH_COMPONENT_Y = 3;
const BLURHASH_IMAGE_SIZE = 48;
const BLURHASH_DATA_URL_SIZE = 32;
const BLURHASH_CACHE_TTL_SECONDS = parsePositiveInt(
  process.env.BLURHASH_CACHE_TTL_SECONDS,
  60 * 60 * 24 * 7,
);
const BLURHASH_FETCH_TIMEOUT_MS = parsePositiveInt(process.env.BLURHASH_FETCH_TIMEOUT_MS, 8000);
const BLURHASH_MAX_IMAGE_BYTES = parsePositiveInt(process.env.BLURHASH_MAX_IMAGE_BYTES, 10 * 1024 * 1024);
const MEMORY_CACHE_TTL_MS = BLURHASH_CACHE_TTL_SECONDS * 1000;

const blurhashMemoryCache = new Map<string, { hash: string; expiresAt: number }>();
const blurhashDataUrlMemoryCache = new Map<string, string>();

function parsePositiveInt(raw: string | undefined, fallback: number) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function makeCacheKey(url: string) {
  const digest = createHash("sha1").update(url).digest("hex");
  return `blurhash:${digest}`;
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map((item) => Number.parseInt(item, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }

  return false;
}

function isPrivateIpv6(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80");
}

function isBlockedHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return isPrivateIpv4(normalized);
  }
  if (ipVersion === 6) {
    return isPrivateIpv6(normalized);
  }

  return false;
}

export function resolveBlurhashSourceUrl(rawSource: string, origin: string) {
  const source = rawSource.trim();
  if (!source) {
    return "";
  }

  try {
    if (source.startsWith("/")) {
      return new URL(source, `${origin}/`).toString();
    }

    const url = new URL(source);
    if (!/^https?:$/i.test(url.protocol)) {
      return "";
    }

    return url.toString();
  } catch {
    return "";
  }
}

export function validateBlurhashSourceUrl(sourceUrl: string, origin: string) {
  try {
    const parsedSource = new URL(sourceUrl);
    const parsedOrigin = new URL(origin);

    // Allow same-origin sources (including local development hosts).
    if (parsedSource.host === parsedOrigin.host) {
      return true;
    }

    if (isBlockedHost(parsedSource.hostname)) {
      return false;
    }

    return /^https?:$/i.test(parsedSource.protocol);
  } catch {
    return false;
  }
}

async function fetchImageBuffer(sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    method: "GET",
    cache: "force-cache",
    signal: AbortSignal.timeout(BLURHASH_FETCH_TIMEOUT_MS),
    headers: {
      Accept: "image/*,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Image request failed: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(`Unsupported content-type: ${contentType}`);
  }

  const contentLength = Number.parseInt(response.headers.get("content-length") || "", 10);
  if (Number.isFinite(contentLength) && contentLength > BLURHASH_MAX_IMAGE_BYTES) {
    throw new Error("Image too large");
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > BLURHASH_MAX_IMAGE_BYTES) {
    throw new Error("Image too large");
  }

  return Buffer.from(arrayBuffer);
}

async function generateBlurhash(sourceUrl: string) {
  const imageBuffer = await fetchImageBuffer(sourceUrl);
  const { data, info } = await sharp(imageBuffer, {
    failOn: "none",
    limitInputPixels: 40_000_000,
  })
    .rotate()
    .resize(BLURHASH_IMAGE_SIZE, BLURHASH_IMAGE_SIZE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = Number(info.width);
  const height = Number(info.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Invalid image dimensions");
  }

  return encode(new Uint8ClampedArray(data), Math.floor(width), Math.floor(height), BLURHASH_COMPONENT_X, BLURHASH_COMPONENT_Y);
}

export async function getBlurhashForImage(sourceUrl: string) {
  const cacheKey = makeCacheKey(sourceUrl);
  const now = Date.now();

  const memory = blurhashMemoryCache.get(cacheKey);
  if (memory && memory.expiresAt > now) {
    return memory.hash;
  }

  const cached = await getRedisJson<{ hash?: string }>(cacheKey);
  if (cached?.hash && cached.hash.trim()) {
    const hash = cached.hash.trim();
    // Ensure existing TTL-based keys are gradually migrated to persistent keys.
    await setRedisJsonPersistent(cacheKey, { hash });
    blurhashMemoryCache.set(cacheKey, {
      hash,
      expiresAt: now + MEMORY_CACHE_TTL_MS,
    });
    return hash;
  }

  const hash = await generateBlurhash(sourceUrl);
  blurhashMemoryCache.set(cacheKey, {
    hash,
    expiresAt: now + MEMORY_CACHE_TTL_MS,
  });
  await setRedisJsonPersistent(cacheKey, { hash });
  return hash;
}

async function resolveBlurhashDataUrl(hash: string) {
  const cached = blurhashDataUrlMemoryCache.get(hash);
  if (cached) {
    return cached;
  }

  const pixels = decode(hash, BLURHASH_DATA_URL_SIZE, BLURHASH_DATA_URL_SIZE);
  const png = await sharp(Buffer.from(pixels), {
    raw: {
      width: BLURHASH_DATA_URL_SIZE,
      height: BLURHASH_DATA_URL_SIZE,
      channels: 4,
    },
  })
    .png()
    .toBuffer();

  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  blurhashDataUrlMemoryCache.set(hash, dataUrl);
  return dataUrl;
}

export async function getBlurhashDataUrlForSource(rawSource: string, origin: string) {
  const sourceUrl = resolveBlurhashSourceUrl(rawSource, origin);
  if (!sourceUrl) {
    return "";
  }

  if (!validateBlurhashSourceUrl(sourceUrl, origin)) {
    return "";
  }

  try {
    const hash = await getBlurhashForImage(sourceUrl);
    return await resolveBlurhashDataUrl(hash);
  } catch {
    return "";
  }
}
