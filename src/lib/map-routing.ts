import { createHash } from "node:crypto";

import { ArticleMapRouteMode } from "./typecho-types";

export const DEFAULT_ROUTING_ENDPOINT = "https://brouter.gpx.studio";
export const ROUTE_CACHE_VERSION = 1;
export const ROUTE_PARSER_VERSION = "route-parser-v1";
export const ROUTE_PROFILE_MAP_VERSION = "brouter-profile-map-v1";

type ResolvedRouteCoordinates = {
  coordinates: Array<[number, number]>;
  fitted: boolean;
};

const routePromiseCache = new Map<string, Promise<ResolvedRouteCoordinates>>();
const ROUTE_PROMISE_CACHE_MAX_ENTRIES = 256;

const brouterProfiles: Record<ArticleMapRouteMode, string> = {
  bike: "Trekking-dry",
  car: "Car-FastEco",
  walk: "Hiking-Alpine-SAC6",
  train: "rail",
};

const ROUTE_COLORS = [
  "#ff6b8a",
  "#67d5b5",
  "#ffd166",
  "#8ec5ff",
  "#f7a072",
  "#b7b5ff",
  "#7bdff2",
  "#f4b6c2",
];

export function getRoutingEndpoint() {
  const endpoint = process.env.MORI_ROUTING_ENDPOINT?.trim() || DEFAULT_ROUTING_ENDPOINT;
  return endpoint.replace(/\/+$/, "");
}

export function normalizeRouteMode(raw: string | undefined | null): ArticleMapRouteMode | null {
  const mode = String(raw || "").trim().toLowerCase();
  if (mode === "bike" || mode === "car" || mode === "walk" || mode === "train") {
    return mode;
  }
  return null;
}

export function getBrouterProfile(mode: ArticleMapRouteMode) {
  return brouterProfiles[mode];
}

export function getRouteColor(index: number) {
  return ROUTE_COLORS[index % ROUTE_COLORS.length];
}

export function buildTrajectoryHash(input: string) {
  return createHash("sha1").update(input).digest("hex");
}

function normalizeLineCoordinates(coordinates: Array<[number, number]>) {
  const normalized: Array<[number, number]> = [];
  coordinates.forEach((point) => {
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return;
    }

    const previous = normalized[normalized.length - 1];
    if (previous && previous[0] === lng && previous[1] === lat) {
      return;
    }

    normalized.push([lng, lat]);
  });

  return normalized;
}

function buildFallbackLine(coordinates: Array<[number, number]>) {
  const normalized = normalizeLineCoordinates(coordinates);
  if (normalized.length >= 2) {
    return normalized;
  }

  if (normalized.length === 1) {
    return [normalized[0], normalized[0]] as Array<[number, number]>;
  }

  return [] as Array<[number, number]>;
}

function buildRoutingCacheKey(endpoint: string, profile: string, points: Array<[number, number]>) {
  const pointText = points.map(([lng, lat]) => `${lng.toFixed(8)},${lat.toFixed(8)}`).join("|");
  return `${endpoint}#${profile}#${pointText}`;
}

function parseBrouterCoordinates(payload: unknown) {
  const features = (payload as { features?: Array<{ geometry?: { coordinates?: unknown } }> })?.features;
  const firstFeature = Array.isArray(features) ? features[0] : null;
  const routeCoordinates = firstFeature?.geometry?.coordinates;
  if (!Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
    return [] as Array<[number, number]>;
  }

  return normalizeLineCoordinates(
    routeCoordinates
      .map((item) => {
        if (!Array.isArray(item) || item.length < 2) {
          return null;
        }

        const lng = Number(item[0]);
        const lat = Number(item[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          return null;
        }

        return [lng, lat] as [number, number];
      })
      .filter((item): item is [number, number] => item !== null),
  );
}

async function fetchFittedRoute(
  endpoint: string,
  profile: string,
  points: Array<[number, number]>,
) {
  const lonlats = points.map(([lng, lat]) => `${lng.toFixed(8)},${lat.toFixed(8)}`).join("|");
  const url = `${endpoint}?lonlats=${encodeURIComponent(lonlats)}&profile=${encodeURIComponent(profile)}&format=geojson&alternativeidx=0`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "MoriMapRoute/1.0 (+https://github.com/Innei/book-ssg-template)",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`routing_http_${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  const coordinates = parseBrouterCoordinates(payload);
  if (coordinates.length < 2) {
    throw new Error("routing_invalid_geometry");
  }

  return coordinates;
}

export async function resolveRouteCoordinates(
  points: Array<[number, number]>,
  mode: ArticleMapRouteMode,
) {
  const normalizedPoints = normalizeLineCoordinates(points);
  if (normalizedPoints.length < 2) {
    return {
      coordinates: buildFallbackLine(points),
      fitted: false,
    };
  }

  const endpoint = getRoutingEndpoint();
  const profile = getBrouterProfile(mode);
  const cacheKey = buildRoutingCacheKey(endpoint, profile, normalizedPoints);
  const existing = routePromiseCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const job = (async () => {
    try {
      const coordinates = await fetchFittedRoute(endpoint, profile, normalizedPoints);
      return {
        coordinates,
        fitted: true,
      };
    } catch {
      routePromiseCache.delete(cacheKey);
      return {
        coordinates: buildFallbackLine(normalizedPoints),
        fitted: false,
      };
    }
  })();

  routePromiseCache.set(cacheKey, job);
  if (routePromiseCache.size > ROUTE_PROMISE_CACHE_MAX_ENTRIES) {
    const oldestKey = routePromiseCache.keys().next().value;
    if (typeof oldestKey === "string" && oldestKey && oldestKey !== cacheKey) {
      routePromiseCache.delete(oldestKey);
    }
  }
  return job;
}

function encodeSignedValue(value: number) {
  let current = value < 0 ? ~(value << 1) : (value << 1);
  let encoded = "";

  while (current >= 0x20) {
    encoded += String.fromCharCode((0x20 | (current & 0x1f)) + 63);
    current >>= 5;
  }

  encoded += String.fromCharCode(current + 63);
  return encoded;
}

export function encodePolyline(coordinates: Array<[number, number]>, precision = 5) {
  let previousLat = 0;
  let previousLng = 0;
  let result = "";
  const factor = 10 ** precision;

  coordinates.forEach(([lng, lat]) => {
    const currentLat = Math.round(lat * factor);
    const currentLng = Math.round(lng * factor);
    result += encodeSignedValue(currentLat - previousLat);
    result += encodeSignedValue(currentLng - previousLng);
    previousLat = currentLat;
    previousLng = currentLng;
  });

  return result;
}

function decodeSignedValue(encoded: string, offset: number) {
  let result = 0;
  let shift = 0;
  let index = offset;
  let byte = 0;

  do {
    byte = encoded.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20 && index < encoded.length + 1);

  const delta = (result & 1) ? ~(result >> 1) : (result >> 1);
  return {
    delta,
    nextOffset: index,
  };
}

export function decodePolyline(encoded: string, precision = 5) {
  if (!encoded) {
    return [] as Array<[number, number]>;
  }

  const coordinates: Array<[number, number]> = [];
  const factor = 10 ** precision;
  let lat = 0;
  let lng = 0;
  let offset = 0;

  while (offset < encoded.length) {
    const latDecoded = decodeSignedValue(encoded, offset);
    lat += latDecoded.delta;
    offset = latDecoded.nextOffset;

    if (offset > encoded.length) {
      break;
    }

    const lngDecoded = decodeSignedValue(encoded, offset);
    lng += lngDecoded.delta;
    offset = lngDecoded.nextOffset;

    coordinates.push([lng / factor, lat / factor]);
  }

  return normalizeLineCoordinates(coordinates);
}
