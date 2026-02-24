import "server-only";

import { createClient } from "redis";

type MoriRedisClient = ReturnType<typeof createClient>;

function parseInteger(raw: string | undefined, fallback: number) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

const REDIS_URL = process.env.REDIS_URL?.trim() ?? "";
const REDIS_HOST = process.env.REDIS_HOST?.trim() ?? "";
const REDIS_PORT = parseInteger(process.env.REDIS_PORT, 6379);
const REDIS_USERNAME = process.env.REDIS_USERNAME?.trim();
const REDIS_PASSWORD = process.env.REDIS_PASSWORD?.trim();
const REDIS_DB = Math.max(0, parseInteger(process.env.REDIS_DB, 0));
const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX?.trim() || "mori";

let redisClient: MoriRedisClient | null = null;
let connectingJob: Promise<MoriRedisClient | null> | null = null;
let warnedUnavailable = false;

function warnOnce(error: unknown) {
  if (warnedUnavailable) {
    return;
  }

  warnedUnavailable = true;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[redis] disabled due to connection error: ${message}`);
}

function isRedisConfigured() {
  return REDIS_URL.length > 0 || REDIS_HOST.length > 0;
}

function makePrefixedKey(key: string) {
  return `${REDIS_KEY_PREFIX}:${key}`;
}

function createRedis(): MoriRedisClient {
  if (REDIS_URL) {
    return createClient({ url: REDIS_URL }) as MoriRedisClient;
  }

  return createClient({
    socket: {
      host: REDIS_HOST,
      port: REDIS_PORT,
    },
    username: REDIS_USERNAME,
    password: REDIS_PASSWORD,
    database: REDIS_DB,
  }) as MoriRedisClient;
}

async function getRedisClient() {
  if (!isRedisConfigured()) {
    return null;
  }

  if (redisClient?.isOpen) {
    return redisClient;
  }

  if (connectingJob) {
    return connectingJob;
  }

  const client = redisClient ?? createRedis();
  redisClient = client;
  client.on("error", warnOnce);

  connectingJob = client
    .connect()
    .then(() => client)
    .catch((error) => {
      warnOnce(error);
      redisClient = null;
      return null;
    })
    .finally(() => {
      connectingJob = null;
    });

  return connectingJob;
}

export async function getRedisJson<T>(key: string): Promise<T | undefined> {
  const client = await getRedisClient();
  if (!client) {
    return undefined;
  }

  try {
    const raw = await client.get(makePrefixedKey(key));
    if (!raw) {
      return undefined;
    }

    return JSON.parse(raw) as T;
  } catch (error) {
    warnOnce(error);
    return undefined;
  }
}

export async function setRedisJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
) {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return;
  }

  const client = await getRedisClient();
  if (!client) {
    return;
  }

  try {
    await client.setEx(makePrefixedKey(key), Math.floor(ttlSeconds), JSON.stringify(value));
  } catch (error) {
    warnOnce(error);
  }
}
