import sanitizeHtml from "sanitize-html";
import { OpenLocationCode } from "open-location-code";

import {
  acquireMapRouteCacheBuildLease,
  releaseMapRouteCacheBuildLease,
  setMapRouteCacheValueToRedis,
  waitForMapRouteCacheValueFromRedis,
} from "./map-route-cache-store";
import {
  buildTrajectoryHash,
  decodePolyline,
  encodePolyline,
  getRouteColor,
  getRoutingEndpoint,
  normalizeRouteMode,
  resolveRouteCoordinates,
  ROUTE_CACHE_VERSION,
  ROUTE_PARSER_VERSION,
  ROUTE_PROFILE_MAP_VERSION,
} from "./map-routing";
import { renderMarkdownToHtml } from "./markdown-render";
import { replaceOwoTokensWithHtml } from "./owo";
import { stripHtml } from "./typecho-normalize";
import { ArticleMapPoint, ArticleMapRoute, ArticleMapRouteMode, TocItem } from "./typecho-types";

function slugifyHeading(text: string) {
  const cleaned = text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
  return cleaned || "section";
}

async function markdownToSafeHtml(rawContent: string | undefined) {
  const source = replaceOwoTokensWithHtml(rawContent?.trim() ?? "");
  if (!source) {
    return "";
  }

  return renderMarkdownToHtml(source);
}

const MARKDOWN_IMAGE_UNIT_PATTERN =
  /<p>\s*(?:<a\b[^>]*\bmori-markdown-image-link\b[^>]*>\s*<img\b[^>]*\bdata-mori-markdown-image="1"[^>]*>\s*<\/a>|<img\b[^>]*\bdata-mori-markdown-image="1"[^>]*>)\s*<\/p>|<a\b[^>]*\bmori-markdown-image-link\b[^>]*>\s*<img\b[^>]*\bdata-mori-markdown-image="1"[^>]*>\s*<\/a>|<img\b[^>]*\bdata-mori-markdown-image="1"[^>]*>/gi;
const MARKDOWN_IMAGE_TAG_IN_UNIT_PATTERN = /<img\b[^>]*\bdata-mori-markdown-image="1"[^>]*>/i;
const MARKDOWN_LIVE_PHOTO_UNIT_PATTERN =
  /<div\b[^>]*\bdata-mori-live-photo-block="1"[^>]*>\s*<div\b[^>]*\bdata-mori-live-photo="1"[^>]*>[\s\S]*?<\/div>\s*(?:<p\b[^>]*\bmori-live-photo-caption\b[^>]*>[\s\S]*?<\/p>)?\s*<\/div>/gi;
const MAP_TOKEN_SPAN_PATTERN = /<span\b[^>]*\bdata-mori-map-token="1"[^>]*><\/span>/gi;
const MAP_TOKEN_PLUS_CODE_WITH_LOCALITY_REGEX =
  /^([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,8})(?:\s+(.+))?$/i;
const MAP_TOKEN_LAT_LNG_REGEX =
  /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:\s+.+)?$/;
const MAP_ROUTE_CACHE_HIT_REQUIRED_KEYS = ["v", "hash", "routes"] as const;

type MapTokenKind = "point" | "route_start" | "route_via" | "route_end" | "route_end_start";

type MapRouteCachePayload = {
  v: number;
  hash: string;
  generatedAt: number;
  sourceModified: number;
  routes: Array<{
    mode: ArticleMapRouteMode;
    color: string;
    startIndex: number;
    endIndex: number;
    pointIndices: number[] | undefined;
    polyline: string;
    fitted: boolean;
  }>;
};

type MapRouteCacheResult = {
  hash: string;
  value: string;
  hit: boolean;
  shouldPersist: boolean;
};

type OpenLocationCodeRuntime = {
  isValid: (code: string) => boolean;
  isFull: (code: string) => boolean;
  isShort: (code: string) => boolean;
  decode: (code: string) => { latitudeCenter: number; longitudeCenter: number };
  recoverNearest: (shortCode: string, latitude: number, longitude: number) => string;
};

const openLocationCode = new (OpenLocationCode as unknown as { new(): OpenLocationCodeRuntime })();
const geocodePromiseCache = new Map<string, Promise<{ lat: number; lng: number } | null>>();
const GEOCODE_PROMISE_CACHE_MAX_ENTRIES = 256;

type MarkdownMediaUnit = {
  kind: "image" | "live";
  html: string;
  start: number;
  end: number;
};

function normalizeMarkdownImageUnitHtml(unitHtml: string) {
  const paragraphMatch = unitHtml.match(/^<p>\s*([\s\S]*?)\s*<\/p>$/i);
  return paragraphMatch ? paragraphMatch[1] : unitHtml;
}

function decodeHtmlEntity(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeBase64Utf8(value: string) {
  if (!value) {
    return "";
  }

  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function readTagAttribute(tag: string, name: string) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const matched = tag.match(pattern);
  if (!matched) {
    return "";
  }
  return matched[1] ?? matched[2] ?? matched[3] ?? "";
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveImageFileNameFromSrc(src: string) {
  if (!src) {
    return "";
  }

  let path = src;
  try {
    const parsed = new URL(src, "https://mori.local");
    path = parsed.pathname || src;
  } catch {
    path = src.split(/[?#]/, 1)[0] || src;
  }

  const baseName = path.split("/").filter(Boolean).pop() || "";
  return safeDecodeURIComponent(baseName);
}

function resolveMarkdownImageCaption(unitHtml: string) {
  const imageTag = unitHtml.match(MARKDOWN_IMAGE_TAG_IN_UNIT_PATTERN)?.[0] || "";
  if (!imageTag) {
    return "";
  }

  const title = decodeHtmlEntity(readTagAttribute(imageTag, "title")).trim();
  const alt = decodeHtmlEntity(readTagAttribute(imageTag, "alt")).trim();
  const src = decodeHtmlEntity(readTagAttribute(imageTag, "data-origin-src") || readTagAttribute(imageTag, "src")).trim();

  return title || alt || resolveImageFileNameFromSrc(src);
}

function resolveLivePhotoCaption(unitHtml: string) {
  const outerTag = unitHtml.match(/^<div\b[^>]*>/i)?.[0] || "";
  const description = decodeHtmlEntity(readTagAttribute(outerTag, "data-live-photo-description")).trim();
  if (description) {
    return description;
  }

  const playerTag = unitHtml.match(/<div\b[^>]*\bdata-mori-live-photo="1"[^>]*>/i)?.[0] || "";
  const ariaLabel = decodeHtmlEntity(readTagAttribute(playerTag, "aria-label")).trim();
  return ariaLabel.toLowerCase() === "live photo" ? "" : ariaLabel;
}

function normalizeMarkdownMediaUnitHtml(unit: MarkdownMediaUnit) {
  if (unit.kind === "image") {
    return normalizeMarkdownImageUnitHtml(unit.html);
  }

  return unit.html.trim();
}

function resolveMarkdownMediaCaption(unit: MarkdownMediaUnit) {
  if (unit.kind === "live") {
    return resolveLivePhotoCaption(unit.html);
  }

  return resolveMarkdownImageCaption(normalizeMarkdownImageUnitHtml(unit.html));
}

function buildMarkdownMediaSingle(unit: MarkdownMediaUnit) {
  const normalized = normalizeMarkdownMediaUnitHtml(unit);
  const caption = resolveMarkdownMediaCaption(unit);
  const captionHtml = caption ? `<figcaption class="mori-image-caption">${escapeHtmlText(caption)}</figcaption>` : "";

  return `<figure class="mori-image-single">${normalized}${captionHtml}</figure>`;
}

function buildMarkdownMediaGallery(units: MarkdownMediaUnit[]) {
  const count = units.length;
  if (count < 2) {
    return "";
  }

  const layoutClass = count === 2 ? "is-dual" : "is-carousel";
  const items = units
    .map((unit, index) => {
      const normalized = normalizeMarkdownMediaUnitHtml(unit);
      const caption = resolveMarkdownMediaCaption(unit);
      const counterText = count > 2 ? `${index + 1} / ${count}` : "";
      const captionInner = [
        counterText ? `<span class="mori-gallery-counter">${counterText}</span>` : "",
        caption ? `<span class="mori-caption-text">${escapeHtmlText(caption)}</span>` : ""
      ].filter(Boolean).join("");
      const captionHtml = captionInner ? `<figcaption class="mori-image-caption">${captionInner}</figcaption>` : "";
      return `<figure class="mori-image-gallery-item">${normalized}${captionHtml}</figure>`;
    })
    .join("");

  return `<div class="mori-image-gallery ${layoutClass}" data-image-count="${count}">${items}</div>`;
}

function collectMarkdownMediaUnits(html: string) {
  const units: MarkdownMediaUnit[] = [];

  MARKDOWN_IMAGE_UNIT_PATTERN.lastIndex = 0;
  let imageMatch: RegExpExecArray | null = MARKDOWN_IMAGE_UNIT_PATTERN.exec(html);
  while (imageMatch) {
    const matchedHtml = imageMatch[0];
    const start = typeof imageMatch.index === "number" ? imageMatch.index : -1;
    if (start >= 0) {
      units.push({
        kind: "image",
        html: matchedHtml,
        start,
        end: start + matchedHtml.length,
      });
    }

    imageMatch = MARKDOWN_IMAGE_UNIT_PATTERN.exec(html);
  }

  MARKDOWN_LIVE_PHOTO_UNIT_PATTERN.lastIndex = 0;
  let liveMatch: RegExpExecArray | null = MARKDOWN_LIVE_PHOTO_UNIT_PATTERN.exec(html);
  while (liveMatch) {
    const matchedHtml = liveMatch[0];
    const start = typeof liveMatch.index === "number" ? liveMatch.index : -1;
    if (start >= 0) {
      units.push({
        kind: "live",
        html: matchedHtml,
        start,
        end: start + matchedHtml.length,
      });
    }

    liveMatch = MARKDOWN_LIVE_PHOTO_UNIT_PATTERN.exec(html);
  }

  if (units.length <= 1) {
    return units;
  }

  return units
    .sort((a, b) => a.start - b.start)
    .filter((unit, index, sorted) => {
      if (index === 0) {
        return true;
      }

      const previous = sorted[index - 1];
      return unit.start >= previous.end;
    });
}

function applyMarkdownImageGalleryLayout(html: string) {
  if (
    !html ||
    (!html.includes("data-mori-markdown-image=\"1\"") && !html.includes("data-mori-live-photo-block=\"1\""))
  ) {
    return html;
  }

  const units = collectMarkdownMediaUnits(html);
  if (units.length === 0) {
    return html;
  }

  const replacements: Array<{ start: number; end: number; html: string }> = [];
  let activeGroup: MarkdownMediaUnit[] = [];

  const flushActiveGroup = () => {
    if (activeGroup.length === 0) {
      activeGroup = [];
      return;
    }

    const first = activeGroup[0];
    const last = activeGroup[activeGroup.length - 1];
    const replacementHtml =
      activeGroup.length === 1 ? buildMarkdownMediaSingle(activeGroup[0]) : buildMarkdownMediaGallery(activeGroup);

    replacements.push({
      start: first.start,
      end: last.end,
      html: replacementHtml,
    });
    activeGroup = [];
  };

  units.forEach((unit, index) => {
    if (activeGroup.length === 0) {
      activeGroup = [unit];
      return;
    }

    const previous = units[index - 1];
    const between = html.slice(previous.end, unit.start);
    if (/^\s*$/.test(between)) {
      activeGroup.push(unit);
      return;
    }

    flushActiveGroup();
    activeGroup = [unit];
  });

  flushActiveGroup();

  if (replacements.length === 0) {
    return html;
  }

  let nextHtml = html;
  for (let i = replacements.length - 1; i >= 0; i -= 1) {
    const replacement = replacements[i];
    nextHtml =
      nextHtml.slice(0, replacement.start) +
      replacement.html +
      nextHtml.slice(replacement.end);
  }

  return nextHtml;
}

function resolveLatLngToken(token: string) {
  const matched = token.match(MAP_TOKEN_LAT_LNG_REGEX);
  if (!matched) {
    return null;
  }

  const lat = Number(matched[1]);
  const lng = Number(matched[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  return {
    lat,
    lng,
    source: "lat_lng" as const,
  };
}

function parsePlusCodeToken(token: string) {
  const matched = token.match(MAP_TOKEN_PLUS_CODE_WITH_LOCALITY_REGEX);
  if (!matched) {
    return null;
  }

  const normalizedCode = String(matched[1] || "").trim().toUpperCase();
  const locality = String(matched[2] || "").trim();
  if (!normalizedCode) {
    return null;
  }

  return {
    normalizedCode,
    locality,
  };
}

async function resolveLocalityReference(localityRaw: string) {
  const locality = localityRaw.trim();
  if (!locality) {
    return null;
  }

  const cacheKey = locality.toLowerCase();
  const cached = geocodePromiseCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const job = (async () => {
    try {
      const query = encodeURIComponent(locality);
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${query}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          "User-Agent": "MoriMap/1.0 (+https://github.com/Innei/book-ssg-template)",
        },
        cache: "force-cache",
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as Array<{ lat?: string; lon?: string }>;
      const first = Array.isArray(payload) ? payload[0] : null;
      const lat = Number(first?.lat);
      const lng = Number(first?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }

      return {
        lat,
        lng,
      };
    } catch {
      return null;
    }
  })();

  geocodePromiseCache.set(cacheKey, job);
  if (geocodePromiseCache.size > GEOCODE_PROMISE_CACHE_MAX_ENTRIES) {
    const oldestKey = geocodePromiseCache.keys().next().value;
    if (typeof oldestKey === "string" && oldestKey && oldestKey !== cacheKey) {
      geocodePromiseCache.delete(oldestKey);
    }
  }

  const resolved = await job;
  if (!resolved) {
    geocodePromiseCache.delete(cacheKey);
  }

  return resolved;
}

async function resolvePlusCodeToken(token: string) {
  const parsed = parsePlusCodeToken(token);
  if (!parsed) {
    return null;
  }

  try {
    const { normalizedCode, locality } = parsed;
    if (!openLocationCode.isValid(normalizedCode)) {
      return null;
    }

    let fullCode = normalizedCode;
    if (!openLocationCode.isFull(fullCode)) {
      if (!openLocationCode.isShort(fullCode) || !locality) {
        return null;
      }

      const reference = await resolveLocalityReference(locality);
      if (!reference) {
        return null;
      }

      fullCode = openLocationCode.recoverNearest(fullCode, reference.lat, reference.lng);
      if (!openLocationCode.isValid(fullCode) || !openLocationCode.isFull(fullCode)) {
        return null;
      }
    }

    const decoded = openLocationCode.decode(fullCode);
    const lat = Number(decoded.latitudeCenter);
    const lng = Number(decoded.longitudeCenter);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    return {
      lat,
      lng,
      source: "plus_code" as const,
    };
  } catch {
    return null;
  }
}

function parseMapTokenKind(rawKind: string) {
  const kind = String(rawKind || "").trim().toLowerCase();
  if (
    kind === "point" ||
    kind === "route_start" ||
    kind === "route_via" ||
    kind === "route_end" ||
    kind === "route_end_start"
  ) {
    return kind as MapTokenKind;
  }
  return "point" as const;
}

function parseMapRouteCachePayload(raw: string | undefined): MapRouteCachePayload | null {
  const compact = String(raw || "").trim();
  if (!compact) {
    return null;
  }

  try {
    const parsed = JSON.parse(compact) as Record<string, unknown>;
    const hasRequiredKeys = MAP_ROUTE_CACHE_HIT_REQUIRED_KEYS.every((key) => Object.prototype.hasOwnProperty.call(parsed, key));
    if (!hasRequiredKeys) {
      return null;
    }

    const v = Number(parsed.v);
    const hash = String(parsed.hash || "").trim();
    const generatedAt = Number(parsed.generatedAt ?? 0);
    const sourceModified = Number(parsed.sourceModified ?? 0);
    const routes = Array.isArray(parsed.routes) ? parsed.routes : null;
    if (v !== ROUTE_CACHE_VERSION || !hash || !routes) {
      return null;
    }

    const normalizedRoutes = routes
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const mode = normalizeRouteMode((item as { mode?: string }).mode);
        const color = String((item as { color?: string }).color || "").trim();
        const startIndex = Number((item as { startIndex?: number }).startIndex);
        const endIndex = Number((item as { endIndex?: number }).endIndex);
        const pointIndicesRaw = (item as { pointIndices?: unknown }).pointIndices;
        const polyline = String((item as { polyline?: string }).polyline || "").trim();
        const fitted = Boolean((item as { fitted?: boolean }).fitted);

        if (!mode || !Number.isFinite(startIndex) || !Number.isFinite(endIndex) || !polyline) {
          return null;
        }

        const normalizedPointIndices = Array.isArray(pointIndicesRaw)
          ? pointIndicesRaw
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value))
            .map((value) => Math.max(0, Math.floor(value)))
            .filter((value, index, bucket) => index === 0 || bucket[index - 1] !== value)
          : [];

        return {
          mode,
          color,
          startIndex: Math.max(0, Math.floor(startIndex)),
          endIndex: Math.max(0, Math.floor(endIndex)),
          pointIndices: normalizedPointIndices.length >= 2 ? normalizedPointIndices : undefined,
          polyline,
          fitted,
        };
      })
      .filter((item): item is MapRouteCachePayload["routes"][number] => item !== null);

    return {
      v,
      hash,
      generatedAt: Number.isFinite(generatedAt) ? generatedAt : Date.now(),
      sourceModified: Number.isFinite(sourceModified) ? sourceModified : 0,
      routes: normalizedRoutes,
    };
  } catch {
    return null;
  }
}

function buildStraightLineCoordinates(points: Array<[number, number]>) {
  const coordinates: Array<[number, number]> = [];
  points.forEach((point) => {
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return;
    }

    const previous = coordinates[coordinates.length - 1];
    if (previous && previous[0] === lng && previous[1] === lat) {
      return;
    }
    coordinates.push([lng, lat]);
  });

  if (coordinates.length >= 2) {
    return coordinates;
  }

  if (coordinates.length === 1) {
    return [coordinates[0], coordinates[0]] as Array<[number, number]>;
  }

  return points.slice(0, 2);
}

interface InjectMapAnchorsOptions {
  enableRouteFitting?: boolean;
  enableRouteCache?: boolean;
  routeCacheFieldValue?: string;
  loadRouteCacheByHash?: (hash: string) => Promise<string | undefined>;
  routeCacheCid?: number;
  sourceModified?: number;
}

interface ResolvedMapToken {
  start: number;
  end: number;
  token: string;
  raw: string;
  kind: MapTokenKind;
  mode: ArticleMapRouteMode | null;
  resolved: { lat: number; lng: number; source: "plus_code" | "lat_lng" } | null;
}

async function injectMapAnchors(html: string, options: InjectMapAnchorsOptions = {}) {
  const enableRouteFitting = options.enableRouteFitting ?? false;
  const enableRouteCache = options.enableRouteCache ?? false;
  const routeCacheCid = Number.isFinite(Number(options.routeCacheCid)) ? Math.max(0, Math.floor(Number(options.routeCacheCid))) : 0;
  const sourceModified = Number.isFinite(Number(options.sourceModified)) ? Number(options.sourceModified) : 0;

  if (!html.includes("data-mori-map-token=\"1\"")) {
    return {
      html,
      mapPoints: [] as ArticleMapPoint[],
      mapRoutes: [] as ArticleMapRoute[],
      mapRouteCache: null as MapRouteCacheResult | null,
    };
  }

  MAP_TOKEN_SPAN_PATTERN.lastIndex = 0;
  const rawMatches = Array.from(html.matchAll(MAP_TOKEN_SPAN_PATTERN));
  if (rawMatches.length === 0) {
    return {
      html,
      mapPoints: [] as ArticleMapPoint[],
      mapRoutes: [] as ArticleMapRoute[],
      mapRouteCache: null as MapRouteCacheResult | null,
    };
  }

  const resolvedTokens = await Promise.all(rawMatches.map(async (match) => {
    const tokenSpan = match[0];
    const start = match.index ?? -1;
    const end = start + tokenSpan.length;
    if (start < 0) {
      return null;
    }

    const tokenBase64 = decodeHtmlEntity(readTagAttribute(tokenSpan, "data-token-b64")).trim();
    const rawBase64 = decodeHtmlEntity(readTagAttribute(tokenSpan, "data-map-raw-b64")).trim();
    const token = decodeBase64Utf8(tokenBase64).trim();
    const raw = decodeBase64Utf8(rawBase64).trim() || (token ? `{${token}}` : "");
    const kind = parseMapTokenKind(readTagAttribute(tokenSpan, "data-map-kind"));
    const mode = normalizeRouteMode(readTagAttribute(tokenSpan, "data-route-mode"));
    if (!token) {
      return {
        start,
        end,
        token,
        raw,
        kind,
        mode,
        resolved: null,
      } satisfies ResolvedMapToken;
    }

    const resolved = resolveLatLngToken(token) ?? await resolvePlusCodeToken(token);
    return {
      start,
      end,
      token,
      raw,
      kind,
      mode,
      resolved,
    } satisfies ResolvedMapToken;
  }));

  const mapPoints: ArticleMapPoint[] = [];
  let mapIndex = 0;
  const replacements: Array<{ start: number; end: number; html: string }> = [];
  const routeDescriptors: Array<{
    mode: ArticleMapRouteMode;
    startIndex: number;
    endIndex: number;
    pointIndices: number[];
  }> = [];
  let activeRouteBuilder: { mode: ArticleMapRouteMode; pointIndices: number[] } | null = null;

  const flushActiveBuilder = () => {
    if (!activeRouteBuilder) {
      return;
    }

    const deduped = activeRouteBuilder.pointIndices.filter((value, idx, bucket) => {
      if (idx === 0) {
        return true;
      }
      return bucket[idx - 1] !== value;
    });

    if (deduped.length >= 2) {
      routeDescriptors.push({
        mode: activeRouteBuilder.mode,
        startIndex: deduped[0],
        endIndex: deduped[deduped.length - 1],
        pointIndices: deduped,
      });
    }
    activeRouteBuilder = null;
  };

  resolvedTokens.forEach((item) => {
    if (!item) {
      return;
    }

    if (!item.resolved) {
      if (activeRouteBuilder && item.kind !== "point") {
        activeRouteBuilder = null;
      }
      replacements.push({
        start: item.start,
        end: item.end,
        html: item.raw ? escapeHtmlText(item.raw) : "",
      });
      return;
    }

    mapIndex += 1;
    const pointId = `mori-map-point-${mapIndex}`;
    const pointIndex = mapPoints.length;
    mapPoints.push({
      id: pointId,
      label: item.token,
      token: item.token,
      lat: item.resolved.lat,
      lng: item.resolved.lng,
      source: item.resolved.source,
    });
    replacements.push({
      start: item.start,
      end: item.end,
      html: `<span id="${pointId}" class="mori-map-anchor" aria-hidden="true"></span>`,
    });

    if (item.kind === "route_start") {
      if (item.mode) {
        activeRouteBuilder = {
          mode: item.mode,
          pointIndices: [pointIndex],
        };
      }
      return;
    }

    if (item.kind === "route_via") {
      if (activeRouteBuilder) {
        activeRouteBuilder.pointIndices.push(pointIndex);
      }
      return;
    }

    if (item.kind === "route_end") {
      if (activeRouteBuilder) {
        activeRouteBuilder.pointIndices.push(pointIndex);
        flushActiveBuilder();
      }
      return;
    }

    if (item.kind === "route_end_start") {
      if (activeRouteBuilder) {
        activeRouteBuilder.pointIndices.push(pointIndex);
        flushActiveBuilder();
      }
      if (item.mode) {
        activeRouteBuilder = {
          mode: item.mode,
          pointIndices: [pointIndex],
        };
      }
    }
  });

  // Incomplete routes (no explicit end token) are ignored by design.
  activeRouteBuilder = null;

  const routingEndpoint = getRoutingEndpoint();
  const normalizedTrajectoryTokens = routeDescriptors
    .map((descriptor) => {
      const pointsText = descriptor.pointIndices
        .map((index) => {
          const point = mapPoints[index];
          if (!point) {
            return "";
          }
          return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
        })
        .filter(Boolean)
        .join("|");
      return `${descriptor.mode}:${pointsText}`;
    })
    .join(";");
  const trajectoryHashInput = `${normalizedTrajectoryTokens}|parser=${ROUTE_PARSER_VERSION}|profile=${ROUTE_PROFILE_MAP_VERSION}|endpoint=${routingEndpoint}`;
  const trajectoryHash = routeDescriptors.length > 0 ? buildTrajectoryHash(trajectoryHashInput) : "";
  let routeCacheRaw = String(options.routeCacheFieldValue || "").trim();
  if (
    enableRouteCache &&
    !routeCacheRaw &&
    trajectoryHash &&
    typeof options.loadRouteCacheByHash === "function"
  ) {
    routeCacheRaw = String(await options.loadRouteCacheByHash(trajectoryHash) || "").trim();
  }
  let routeCachePayload = enableRouteCache ? parseMapRouteCachePayload(routeCacheRaw) : null;
  const mapRoutes: ArticleMapRoute[] = [];

  let canUseRouteCache =
    enableRouteCache &&
    Boolean(routeCachePayload) &&
    Boolean(trajectoryHash) &&
    routeCachePayload?.v === ROUTE_CACHE_VERSION &&
    routeCachePayload?.hash === trajectoryHash;

  let routeCacheLeaseToken = "";
  if (enableRouteCache && trajectoryHash && !canUseRouteCache && routeCacheCid > 0) {
    let leaseResult = await acquireMapRouteCacheBuildLease(routeCacheCid, trajectoryHash);
    if (leaseResult.status === "acquired") {
      routeCacheLeaseToken = leaseResult.token;
    }

    if (leaseResult.status === "contended") {
      routeCacheRaw = String(await waitForMapRouteCacheValueFromRedis({
        cid: routeCacheCid,
        sourceHash: trajectoryHash,
      }) || "").trim();
      routeCachePayload = parseMapRouteCachePayload(routeCacheRaw);
      canUseRouteCache =
        Boolean(routeCachePayload) &&
        routeCachePayload?.v === ROUTE_CACHE_VERSION &&
        routeCachePayload?.hash === trajectoryHash;

      if (!canUseRouteCache) {
        leaseResult = await acquireMapRouteCacheBuildLease(routeCacheCid, trajectoryHash);
        if (leaseResult.status === "acquired") {
          routeCacheLeaseToken = leaseResult.token;
        }
      }
    }

    if (routeCacheLeaseToken && typeof options.loadRouteCacheByHash === "function") {
      routeCacheRaw = String(await options.loadRouteCacheByHash(trajectoryHash) || "").trim();
      routeCachePayload = parseMapRouteCachePayload(routeCacheRaw);
      canUseRouteCache =
        Boolean(routeCachePayload) &&
        routeCachePayload?.v === ROUTE_CACHE_VERSION &&
        routeCachePayload?.hash === trajectoryHash;
    }
  }

  let mapRouteCache: MapRouteCacheResult | null = null;
  try {
    if (canUseRouteCache && routeCachePayload) {
      routeCachePayload.routes.forEach((routeItem, index) => {
        const startPoint = mapPoints[routeItem.startIndex];
        const endPoint = mapPoints[routeItem.endIndex];
        if (!startPoint || !endPoint) {
          return;
        }

        const decoded = decodePolyline(routeItem.polyline);
        const routeCoordinates = decoded.length >= 2
          ? decoded
          : buildStraightLineCoordinates([
            [startPoint.lng, startPoint.lat],
            [endPoint.lng, endPoint.lat],
          ]);

        if (routeCoordinates.length < 2) {
          return;
        }

        mapRoutes.push({
          id: `mori-map-route-${index + 1}`,
          mode: routeItem.mode,
          color: routeItem.color || getRouteColor(index),
          startPointId: startPoint.id,
          endPointId: endPoint.id,
          startIndex: routeItem.startIndex,
          endIndex: routeItem.endIndex,
          pointIndices:
            Array.isArray(routeItem.pointIndices) && routeItem.pointIndices.length >= 2
              ? routeItem.pointIndices
              : routeDescriptors[index]?.pointIndices,
          coordinates: routeCoordinates,
          fitted: routeItem.fitted,
        });
      });
    } else {
      const resolvedRoutes = await Promise.all(routeDescriptors.map(async (descriptor) => {
        const descriptorPoints = descriptor.pointIndices
          .map((index) => mapPoints[index])
          .filter((item): item is ArticleMapPoint => Boolean(item))
          .map((point) => [point.lng, point.lat] as [number, number]);

        if (descriptorPoints.length < 2) {
          return null;
        }

        if (!enableRouteFitting) {
          return {
            coordinates: buildStraightLineCoordinates(descriptorPoints),
            fitted: false,
          };
        }

        const routed = await resolveRouteCoordinates(descriptorPoints, descriptor.mode);
        const safeCoordinates = routed.coordinates.length >= 2
          ? routed.coordinates
          : buildStraightLineCoordinates(descriptorPoints);

        return {
          coordinates: safeCoordinates,
          fitted: routed.fitted && safeCoordinates.length >= 2,
        };
      }));

      resolvedRoutes.forEach((routeResult, index) => {
        if (!routeResult || routeResult.coordinates.length < 2) {
          return;
        }

        const descriptor = routeDescriptors[index];
        const startPoint = mapPoints[descriptor.startIndex];
        const endPoint = mapPoints[descriptor.endIndex];
        if (!startPoint || !endPoint) {
          return;
        }

        mapRoutes.push({
          id: `mori-map-route-${mapRoutes.length + 1}`,
          mode: descriptor.mode,
          color: getRouteColor(index),
          startPointId: startPoint.id,
          endPointId: endPoint.id,
          startIndex: descriptor.startIndex,
          endIndex: descriptor.endIndex,
          pointIndices: descriptor.pointIndices,
          coordinates: routeResult.coordinates,
          fitted: routeResult.fitted,
        });
      });
    }

    if (enableRouteCache && routeDescriptors.length > 0 && trajectoryHash) {
      const encodedPayload: MapRouteCachePayload = {
        v: ROUTE_CACHE_VERSION,
        hash: trajectoryHash,
        generatedAt: Date.now(),
        sourceModified,
        routes: mapRoutes.map((route) => ({
          mode: route.mode,
          color: route.color,
          startIndex: route.startIndex,
          endIndex: route.endIndex,
          pointIndices: route.pointIndices,
          polyline: encodePolyline(route.coordinates),
          fitted: route.fitted,
        })),
      };
      const encodedPayloadValue = JSON.stringify(encodedPayload);

      if (!canUseRouteCache && routeCacheCid > 0) {
        await setMapRouteCacheValueToRedis({
          cid: routeCacheCid,
          sourceHash: trajectoryHash,
          value: encodedPayloadValue,
          sourceModified,
        });
      }

      mapRouteCache = {
        hash: trajectoryHash,
        value: encodedPayloadValue,
        hit: canUseRouteCache,
        shouldPersist: false,
      };
    }
  } finally {
    if (routeCacheLeaseToken && trajectoryHash && routeCacheCid > 0) {
      await releaseMapRouteCacheBuildLease(routeCacheCid, trajectoryHash, routeCacheLeaseToken);
    }
  }

  if (replacements.length === 0) {
    return {
      html,
      mapPoints,
      mapRoutes,
      mapRouteCache,
    };
  }

  let mappedHtml = html;
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const replacement = replacements[index];
    mappedHtml =
      mappedHtml.slice(0, replacement.start) +
      replacement.html +
      mappedHtml.slice(replacement.end);
  }

  return {
    html: mappedHtml,
    mapPoints,
    mapRoutes,
    mapRouteCache,
  };
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "blockquote",
    "ul",
    "ol",
    "li",
    "code",
    "pre",
    "strong",
    "em",
    "del",
    "ins",
    "mark",
    "span",
    "div",
    "aside",
    "a",
    "img",
    "hr",
    "br",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "sup",
    "sub",
    "details",
    "summary",
    "cite",
    "footer",
    "button",
    "iframe",
    "input",
    "math",
    "semantics",
    "annotation",
    "annotation-xml",
    "mrow",
    "mi",
    "mn",
    "mo",
    "msup",
    "msub",
    "msubsup",
    "mfrac",
    "msqrt",
    "mroot",
    "munder",
    "mover",
    "munderover",
    "mtable",
    "mtr",
    "mtd",
    "mstyle",
    "mspace",
    "mtext",
    "mfenced",
    "menclose",
    "mpadded",
    "mphantom",
    "svg",
    "path",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: [
      "src",
      "data-origin-src",
      "data-origin-srcset",
      "data-origin-sizes",
      "alt",
      "title",
      "width",
      "height",
      "loading",
      "decoding",
      "class",
      "aria-hidden",
      "data-mori-markdown-image",
    ],
    svg: ["class", "viewBox", "width", "height", "aria-hidden", "fill"],
    path: ["d", "fill", "fill-rule", "clip-rule"],
    iframe: [
      "src",
      "title",
      "loading",
      "allow",
      "allowfullscreen",
      "referrerpolicy",
      "sandbox",
      "class",
    ],
    button: [
      "type",
      "class",
      "data-code-b64",
      "data-copy-state",
      "data-tab-index",
      "aria-selected",
      "aria-controls",
      "aria-label",
    ],
    pre: ["class", "style", "tabindex"],
    code: ["class", "style"],
    span: [
      "class",
      "style",
      "aria-hidden",
      "data-mori-map-token",
      "data-token-b64",
      "data-map-kind",
      "data-route-mode",
      "data-map-raw-b64",
    ],
    input: ["checked", "disabled", "readonly", "type"],
    math: ["display", "xmlns"],
    annotation: ["encoding"],
    "*": [
      "id",
      "class",
      "data-callout",
      "data-container",
      "data-mori-tabs",
      "data-mori-excalidraw",
      "data-mori-friend-links",
      "data-mori-live-photo-block",
      "data-mori-live-photo",
      "data-live-photo-description",
      "data-photo-src",
      "data-video-src",
      "data-items",
      "data-tab-index",
      "data-source",
      "data-mori-map-token",
      "data-token-b64",
      "data-map-kind",
      "data-route-mode",
      "data-map-raw-b64",
      "aria-hidden",
      "aria-label",
      "aria-controls",
      "aria-labelledby",
      "aria-selected",
      "tabindex",
      "role",
    ],
  },
  parseStyleAttributes: false,
  allowedSchemes: ["http", "https", "mailto", "tel", "data"],
  transformTags: {
    a: (tagName, attribs) => {
      const href = typeof attribs.href === "string" ? attribs.href.trim() : "";
      const isExternal = /^(https?:|mailto:|tel:)/i.test(href);
      const isHashLink = href.startsWith("#");

      if (isHashLink || !isExternal) {
        return {
          tagName,
          attribs,
        };
      }

      return {
        tagName,
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      };
    },
    input: (_tagName, attribs) => {
      const inputAttributes: Record<string, string> = {
        disabled: "disabled",
        readonly: "readonly",
        type: "checkbox",
      };

      if (Object.prototype.hasOwnProperty.call(attribs, "checked")) {
        inputAttributes.checked = "checked";
      }

      return {
        tagName: "input",
        attribs: inputAttributes,
      };
    },
    img: (tagName, attribs) => {
      return {
        tagName,
        attribs: {
          ...attribs,
          loading: attribs.loading ?? "lazy",
          decoding: attribs.decoding ?? "async",
        },
      };
    },
    iframe: (tagName, attribs) => {
      const src = typeof attribs.src === "string" ? attribs.src.trim() : "";
      const safe =
        /^https:\/\/(www\.)?youtube\.com\/embed\//i.test(src) ||
        /^https:\/\/player\.bilibili\.com\/player\.html/i.test(src) ||
        /^https:\/\/codesandbox\.io\/embed\//i.test(src) ||
        /^https:\/\/codesandbox\.io\/p\/devbox\//i.test(src) ||
        /^https:\/\/(www\.)?excalidraw\.com\//i.test(src) ||
        /^https:\/\/app\.excalidraw\.com\//i.test(src);

      if (!safe) {
        return {
          tagName: "div",
          attribs: {},
        };
      }

      return {
        tagName,
        attribs: {
          ...attribs,
          loading: attribs.loading ?? "lazy",
          referrerpolicy: attribs.referrerpolicy ?? "strict-origin-when-cross-origin",
        },
      };
    },
  },
};

interface PrepareArticleContentOptions {
  enableRouteFitting?: boolean;
  enableRouteCache?: boolean;
  routeCacheFieldValue?: string;
  loadRouteCacheByHash?: (hash: string) => Promise<string | undefined>;
  routeCacheCid?: number;
  sourceModified?: number;
}

export async function prepareArticleContent(rawContent: string | undefined, options: PrepareArticleContentOptions = {}) {
  const htmlSource = await markdownToSafeHtml(rawContent);
  const cleaned = sanitizeHtml(htmlSource, SANITIZE_OPTIONS);
  const withImageGalleries = applyMarkdownImageGalleryLayout(cleaned);
  const withMapAnchors = await injectMapAnchors(withImageGalleries, {
    enableRouteFitting: options.enableRouteFitting,
    enableRouteCache: options.enableRouteCache,
    routeCacheFieldValue: options.routeCacheFieldValue,
    loadRouteCacheByHash: options.loadRouteCacheByHash,
    routeCacheCid: options.routeCacheCid,
    sourceModified: options.sourceModified,
  });

  const tocItems: TocItem[] = [];
  let index = 0;

  const htmlWithHeadingIds = withMapAnchors.html.replace(
    /<h([1-4])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (_, level, attrs, inner) => {
      index += 1;
      const text = stripHtml(inner);
      const base = slugifyHeading(text);
      const id = `${base}-${index}`;
      const headingLevel = Number(level);

      if (headingLevel >= 1) {
        tocItems.push({
          id,
          text,
          level: headingLevel,
        });
      }

      const attrsWithoutId = String(attrs).replace(/\sid\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "");
      return `<h${level}${attrsWithoutId} id="${id}" data-markdown-heading="true">${inner}<a class="mori-heading-anchor" href="#${id}" aria-label="章节链接">#</a></h${level}>`;
    },
  );

  return {
    html: htmlWithHeadingIds,
    tocItems,
    mapPoints: withMapAnchors.mapPoints,
    mapRoutes: withMapAnchors.mapRoutes,
    mapRouteCache: withMapAnchors.mapRouteCache,
  };
}
