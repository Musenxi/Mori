import "server-only";

import { randomUUID } from "node:crypto";

import { ROUTE_CACHE_VERSION } from "./map-routing";
import {
  deleteRedisByPattern,
  deleteRedisKeyIfValueMatches,
  getRedisJson,
  setRedisJsonPersistent,
  setRedisStringIfAbsent,
} from "./redis-client";

const MAP_ROUTE_CACHE_REDIS_SCHEMA_VERSION = 2;
const MAP_ROUTE_CACHE_REDIS_LEGACY_SCHEMA_VERSION = 1;
const MAP_ROUTE_CACHE_BUILD_LOCK_TTL_MS = 15000;
const MAP_ROUTE_CACHE_BUILD_WAIT_MS = 8000;
const MAP_ROUTE_CACHE_BUILD_POLL_INTERVAL_MS = 250;

type MapRouteCacheRedisEntry = {
  v: number;
  sourceHash: string;
  value: string;
  sourceModified: number;
  updatedAt: number;
};

export type MapRouteCacheBuildLeaseResult =
  | { status: "acquired"; token: string }
  | { status: "contended"; token: "" }
  | { status: "unavailable"; token: "" };

function normalizeCid(rawCid: unknown) {
  const cid = Number(rawCid);
  if (!Number.isFinite(cid) || cid <= 0) {
    return 0;
  }
  return Math.floor(cid);
}

function normalizeHash(rawHash: unknown) {
  const hash = String(rawHash || "").trim().toLowerCase();
  if (!hash || !/^[a-f0-9]{40}$/i.test(hash)) {
    return "";
  }
  return hash;
}

function normalizeSourceModified(rawSourceModified: unknown) {
  const sourceModified = Number(rawSourceModified);
  if (!Number.isFinite(sourceModified) || sourceModified < 0) {
    return 0;
  }
  return Math.floor(sourceModified);
}

function buildMapRouteCacheRedisKey(cid: number) {
  return `typecho:map-route-cache:v${ROUTE_CACHE_VERSION}:schema:${MAP_ROUTE_CACHE_REDIS_SCHEMA_VERSION}:cid:${cid}:latest`;
}

function buildLegacyMapRouteCacheRedisKey(cid: number, hash: string) {
  return `typecho:map-route-cache:v${ROUTE_CACHE_VERSION}:schema:${MAP_ROUTE_CACHE_REDIS_LEGACY_SCHEMA_VERSION}:cid:${cid}:hash:${hash}`;
}

function buildLegacyMapRouteCacheRedisPattern(cid: number) {
  return `typecho:map-route-cache:v${ROUTE_CACHE_VERSION}:schema:${MAP_ROUTE_CACHE_REDIS_LEGACY_SCHEMA_VERSION}:cid:${cid}:hash:*`;
}

function buildMapRouteCacheBuildLockRedisKey(cid: number, hash: string) {
  return `typecho:map-route-cache:v${ROUTE_CACHE_VERSION}:schema:${MAP_ROUTE_CACHE_REDIS_SCHEMA_VERSION}:cid:${cid}:hash:${hash}:build-lock`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseMapRouteCacheRedisEntry(raw: unknown): MapRouteCacheRedisEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const payload = raw as Partial<MapRouteCacheRedisEntry>;
  const sourceHash = normalizeHash(payload.sourceHash);
  const value = typeof payload.value === "string" ? payload.value.trim() : "";
  if (payload.v !== ROUTE_CACHE_VERSION || !sourceHash || !value) {
    return null;
  }

  return {
    v: ROUTE_CACHE_VERSION,
    sourceHash,
    value,
    sourceModified: normalizeSourceModified(payload.sourceModified),
    updatedAt: normalizeSourceModified(payload.updatedAt),
  };
}

async function getLegacyMapRouteCacheValue(cid: number, sourceHash: string) {
  const legacyKey = buildLegacyMapRouteCacheRedisKey(cid, sourceHash);
  const cached = await getRedisJson<string>(legacyKey);
  if (typeof cached !== "string") {
    return undefined;
  }

  const compact = cached.trim();
  return compact || undefined;
}

export async function getMapRouteCacheValueFromRedis(cid: number, sourceHash: string): Promise<string | undefined> {
  const normalizedCid = normalizeCid(cid);
  const normalizedHash = normalizeHash(sourceHash);
  if (!normalizedCid || !normalizedHash) {
    return undefined;
  }

  const key = buildMapRouteCacheRedisKey(normalizedCid);
  const cached = parseMapRouteCacheRedisEntry(await getRedisJson<MapRouteCacheRedisEntry>(key));
  if (cached?.sourceHash === normalizedHash) {
    return cached.value;
  }

  return getLegacyMapRouteCacheValue(normalizedCid, normalizedHash);
}

export async function setMapRouteCacheValueToRedis(input: {
  cid: number;
  sourceHash: string;
  value: string;
  sourceModified?: number;
}) {
  const normalizedCid = normalizeCid(input.cid);
  const normalizedHash = normalizeHash(input.sourceHash);
  const value = String(input.value || "").trim();
  const sourceModified = normalizeSourceModified(input.sourceModified);
  if (!normalizedCid || !normalizedHash || !value) {
    return;
  }

  const key = buildMapRouteCacheRedisKey(normalizedCid);
  const existing = parseMapRouteCacheRedisEntry(await getRedisJson<MapRouteCacheRedisEntry>(key));
  if (existing && existing.sourceModified > sourceModified) {
    return;
  }

  await setRedisJsonPersistent(key, {
    v: ROUTE_CACHE_VERSION,
    sourceHash: normalizedHash,
    value,
    sourceModified,
    updatedAt: Date.now(),
  } satisfies MapRouteCacheRedisEntry);

  await deleteRedisByPattern(buildLegacyMapRouteCacheRedisPattern(normalizedCid), {
    maxKeys: 32,
    batchSize: 32,
    scanCount: 64,
  });
}

export async function acquireMapRouteCacheBuildLease(
  cid: number,
  sourceHash: string,
): Promise<MapRouteCacheBuildLeaseResult> {
  const normalizedCid = normalizeCid(cid);
  const normalizedHash = normalizeHash(sourceHash);
  if (!normalizedCid || !normalizedHash) {
    return {
      status: "unavailable",
      token: "",
    };
  }

  const token = randomUUID();
  const acquired = await setRedisStringIfAbsent(
    buildMapRouteCacheBuildLockRedisKey(normalizedCid, normalizedHash),
    token,
    MAP_ROUTE_CACHE_BUILD_LOCK_TTL_MS,
  );

  if (acquired === true) {
    return {
      status: "acquired",
      token,
    };
  }

  if (acquired === false) {
    return {
      status: "contended",
      token: "",
    };
  }

  return {
    status: "unavailable",
    token: "",
  };
}

export async function releaseMapRouteCacheBuildLease(cid: number, sourceHash: string, token: string) {
  const normalizedCid = normalizeCid(cid);
  const normalizedHash = normalizeHash(sourceHash);
  const normalizedToken = String(token || "").trim();
  if (!normalizedCid || !normalizedHash || !normalizedToken) {
    return;
  }

  await deleteRedisKeyIfValueMatches(
    buildMapRouteCacheBuildLockRedisKey(normalizedCid, normalizedHash),
    normalizedToken,
  );
}

export async function waitForMapRouteCacheValueFromRedis(input: {
  cid: number;
  sourceHash: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}) {
  const normalizedCid = normalizeCid(input.cid);
  const normalizedHash = normalizeHash(input.sourceHash);
  if (!normalizedCid || !normalizedHash) {
    return undefined;
  }

  const timeoutMs = Number.isFinite(input.timeoutMs)
    ? Math.max(0, Math.floor(input.timeoutMs ?? 0))
    : MAP_ROUTE_CACHE_BUILD_WAIT_MS;
  const pollIntervalMs = Number.isFinite(input.pollIntervalMs)
    ? Math.max(50, Math.floor(input.pollIntervalMs ?? 0))
    : MAP_ROUTE_CACHE_BUILD_POLL_INTERVAL_MS;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const cached = await getMapRouteCacheValueFromRedis(normalizedCid, normalizedHash);
    if (cached) {
      return cached;
    }

    if (Date.now() >= deadline) {
      break;
    }

    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }

  return undefined;
}
