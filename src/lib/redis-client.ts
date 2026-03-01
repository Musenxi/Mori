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
const REDIS_CONNECT_TIMEOUT_MS = Math.max(1000, parseInteger(process.env.REDIS_CONNECT_TIMEOUT_MS, 5000));
const REDIS_KEEP_ALIVE_MS = Math.max(1000, parseInteger(process.env.REDIS_KEEP_ALIVE_MS, 5000));
const REDIS_PING_INTERVAL_MS = Math.max(1000, parseInteger(process.env.REDIS_PING_INTERVAL_MS, 30000));
const REDIS_RETRY_BASE_MS = Math.max(100, parseInteger(process.env.REDIS_RETRY_BASE_MS, 200));
const REDIS_RETRY_MAX_MS = Math.max(1000, parseInteger(process.env.REDIS_RETRY_MAX_MS, 3000));

let redisClient: MoriRedisClient | null = null;
let connectingJob: Promise<MoriRedisClient | null> | null = null;
let warnedUnavailable = false;

function warnOnce(error: unknown) {
  if (warnedUnavailable) {
    return;
  }

  warnedUnavailable = true;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[redis] temporarily unavailable, fallback enabled: ${message}`);
}

function isRedisConfigured() {
  return REDIS_URL.length > 0 || REDIS_HOST.length > 0;
}

function makePrefixedKey(key: string) {
  return `${REDIS_KEY_PREFIX}:${key}`;
}

function makePrefixedPattern(pattern: string) {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return makePrefixedKey("*");
  }

  const prefix = `${REDIS_KEY_PREFIX}:`;
  if (trimmed.startsWith(prefix)) {
    return trimmed;
  }

  return makePrefixedKey(trimmed);
}

function createRedis(): MoriRedisClient {
  const socket = {
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelay: REDIS_KEEP_ALIVE_MS,
    reconnectStrategy: (retries: number) => {
      const attempt = Math.max(1, Number.isFinite(retries) ? retries : 1);
      return Math.min(REDIS_RETRY_BASE_MS * attempt, REDIS_RETRY_MAX_MS);
    },
  };

  const client = REDIS_URL
    ? (createClient({
      url: REDIS_URL,
      socket,
      pingInterval: REDIS_PING_INTERVAL_MS,
    }) as MoriRedisClient)
    : (createClient({
      socket: {
        ...socket,
        host: REDIS_HOST,
        port: REDIS_PORT,
      },
      username: REDIS_USERNAME,
      password: REDIS_PASSWORD,
      database: REDIS_DB,
      pingInterval: REDIS_PING_INTERVAL_MS,
    }) as MoriRedisClient);

  client.on("error", warnOnce);
  client.on("ready", () => {
    if (!warnedUnavailable) {
      return;
    }

    warnedUnavailable = false;
    console.info("[redis] connection restored");
  });

  return client;
}

function shouldResetClient(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /socket closed unexpectedly|connection is closed/i.test(error.message);
}

function resetClient() {
  if (redisClient) {
    redisClient.removeAllListeners();
  }
  redisClient = null;
}

function handleRedisOperationError(error: unknown) {
  warnOnce(error);
  if (shouldResetClient(error)) {
    resetClient();
  }
}

async function getRedisClient() {
  if (!isRedisConfigured()) {
    return null;
  }

  if (redisClient?.isReady) {
    return redisClient;
  }

  if (connectingJob) {
    return connectingJob;
  }

  const client = redisClient ?? createRedis();
  redisClient = client;

  connectingJob = client
    .connect()
    .then(() => client)
    .catch((error) => {
      handleRedisOperationError(error);
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
    handleRedisOperationError(error);
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
    handleRedisOperationError(error);
  }
}

export async function setRedisJsonPersistent(
  key: string,
  value: unknown,
) {
  const client = await getRedisClient();
  if (!client) {
    return;
  }

  try {
    await client.set(makePrefixedKey(key), JSON.stringify(value));
  } catch (error) {
    handleRedisOperationError(error);
  }
}

export async function deleteRedisByPattern(
  pattern: string,
  options: { maxKeys?: number; batchSize?: number; scanCount?: number } = {},
): Promise<number> {
  const client = await getRedisClient();
  if (!client) {
    return 0;
  }

  const match = makePrefixedPattern(pattern);
  const maxKeysValue = Number.isFinite(options.maxKeys)
    ? Math.max(0, Math.floor(options.maxKeys ?? 0))
    : undefined;
  const maxKeys = maxKeysValue && maxKeysValue > 0 ? maxKeysValue : Infinity;
  const batchSize = Number.isFinite(options.batchSize)
    ? Math.max(10, Math.floor(options.batchSize ?? 0))
    : 200;
  const scanCount = Number.isFinite(options.scanCount)
    ? Math.max(10, Math.floor(options.scanCount ?? 0))
    : 200;

  let deleted = 0;
  let processed = 0;
  const batch: string[] = [];

  try {
    for await (const chunk of client.scanIterator({ MATCH: match, COUNT: scanCount })) {
      const keys = Array.isArray(chunk) ? chunk : [chunk];

      for (const key of keys) {
        batch.push(key);
        processed += 1;

        if (batch.length >= batchSize) {
          const removed = await client.del(batch);
          deleted += typeof removed === "number" ? removed : 0;
          batch.length = 0;
        }

        if (processed >= maxKeys) {
          break;
        }
      }

      if (processed >= maxKeys) {
        break;
      }
    }

    if (batch.length > 0) {
      const removed = await client.del(batch);
      deleted += typeof removed === "number" ? removed : 0;
    }

    return deleted;
  } catch (error) {
    handleRedisOperationError(error);
    return deleted;
  }
}
