import "server-only";

import {
  ProcessReporterIncomingPayload,
  ProcessReporterStatusSnapshot,
} from "@/lib/process-reporter-types";
import { getRedisJson, setRedisJson } from "@/lib/redis-client";

const PROCESS_REPORTER_STATUS_KEY = "process-reporter:latest";
const PROCESS_REPORTER_STATUS_TTL_SECONDS = normalizePositiveInt(
  process.env.PROCESS_REPORTER_STATUS_TTL_SECONDS,
  3600,
);
const PROCESS_REPORTER_STALE_SECONDS = normalizePositiveInt(
  process.env.PROCESS_REPORTER_STALE_SECONDS,
  180,
);
const PROCESS_REPORTER_ENABLED = normalizeBoolean(process.env.PROCESS_REPORTER_ENABLED, true);

let memorySnapshot: ProcessReporterStatusSnapshot | null = null;

function normalizePositiveInt(raw: string | undefined, fallback: number) {
  if (!raw || !raw.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeBoolean(raw: string | undefined, fallback: boolean) {
  if (!raw || !raw.trim()) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeNonEmptyString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getProcessReporterApiKey() {
  return process.env.PROCESS_REPORTER_API_KEY?.trim() || "";
}

export function isProcessReporterEnabled() {
  return PROCESS_REPORTER_ENABLED;
}

export function toProcessReporterSnapshot(payload: ProcessReporterIncomingPayload): ProcessReporterStatusSnapshot {
  const now = Date.now();
  const sourceTimestamp = Number(payload.timestamp);
  const normalizedTimestamp =
    Number.isFinite(sourceTimestamp) && sourceTimestamp > 0 ? Math.floor(sourceTimestamp) : null;
  const staleAt = now + PROCESS_REPORTER_STALE_SECONDS * 1000;

  return {
    process: normalizeNonEmptyString(payload.process),
    description: normalizeNonEmptyString(payload.meta?.description),
    mediaTitle: normalizeNonEmptyString(payload.media?.title),
    mediaArtist: normalizeNonEmptyString(payload.media?.artist),
    updatedAt: now,
    sourceTimestamp: normalizedTimestamp,
    staleAt,
  };
}

export function isProcessReporterSnapshotStale(snapshot: ProcessReporterStatusSnapshot | null) {
  if (!snapshot) {
    return true;
  }

  return Date.now() > snapshot.staleAt;
}

export async function saveProcessReporterSnapshot(snapshot: ProcessReporterStatusSnapshot) {
  memorySnapshot = snapshot;
  await setRedisJson(PROCESS_REPORTER_STATUS_KEY, snapshot, PROCESS_REPORTER_STATUS_TTL_SECONDS);
}

export async function getProcessReporterSnapshot() {
  const cached = await getRedisJson<ProcessReporterStatusSnapshot>(PROCESS_REPORTER_STATUS_KEY);
  if (cached) {
    memorySnapshot = cached;
    return cached;
  }

  return memorySnapshot;
}
