import { NextRequest, NextResponse } from "next/server";

import {
  getProcessReporterApiKey,
  getProcessReporterSnapshot,
  isProcessReporterSnapshotStale,
  isProcessReporterEnabled,
  saveProcessReporterSnapshot,
  toProcessReporterSnapshot,
} from "@/lib/process-reporter-status";
import {
  ProcessReporterIncomingPayload,
  ProcessReporterStatusResponse,
  ProcessReporterStatusSnapshot,
} from "@/lib/process-reporter-types";

export const runtime = "nodejs";

const PROCESS_REPORTER_UPDATED_EVENT = "process-reporter:updated";
const PROCESS_REPORTER_SOCKET_ROOM = "process-reporter:watchers";

function toJson(data: ProcessReporterStatusResponse | { ok: boolean; message: string }, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

function resolveBroadcastOrigin(request: NextRequest) {
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

function getSocketInternalToken() {
  const token = process.env.SOCKET_INTERNAL_TOKEN;
  if (typeof token === "string" && token.trim()) {
    return token.trim();
  }
  return "mori-local-socket-token";
}

async function emitProcessReporterUpdated(request: NextRequest, snapshot: ProcessReporterStatusSnapshot) {
  try {
    const response = await fetch(`${resolveBroadcastOrigin(request)}/internal/socket-broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mori-socket-token": getSocketInternalToken(),
      },
      cache: "no-store",
      body: JSON.stringify({
        event: PROCESS_REPORTER_UPDATED_EVENT,
        rooms: [PROCESS_REPORTER_SOCKET_ROOM],
        payload: snapshot,
      }),
    });
    if (!response.ok) {
      console.warn(`[process-reporter] socket bridge failed with status ${response.status}`);
    }
  } catch {
    console.warn("[process-reporter] socket bridge failed");
  }
}

function hasReadableStatus(snapshot: ProcessReporterStatusSnapshot) {
  return Boolean(snapshot.process || snapshot.mediaTitle || snapshot.description);
}

export async function GET() {
  const enabled = isProcessReporterEnabled();
  if (!enabled) {
    return toJson({
      ok: true,
      data: null,
      stale: true,
      enabled: false,
    });
  }

  const snapshot = await getProcessReporterSnapshot();
  const stale = isProcessReporterSnapshotStale(snapshot ?? null);

  return toJson({
    ok: true,
    data: snapshot ?? null,
    stale,
    enabled: true,
  });
}

export async function POST(request: NextRequest) {
  if (!isProcessReporterEnabled()) {
    return toJson(
      {
        ok: false,
        message: "ProcessReporter 已在服务端关闭。",
      },
      403,
    );
  }

  const expectedApiKey = getProcessReporterApiKey();
  if (!expectedApiKey) {
    return toJson(
      {
        ok: false,
        message: "PROCESS_REPORTER_API_KEY 未配置。",
      },
      503,
    );
  }

  let payload: ProcessReporterIncomingPayload;
  try {
    payload = (await request.json()) as ProcessReporterIncomingPayload;
  } catch {
    return toJson(
      {
        ok: false,
        message: "请求体必须是 JSON。",
      },
      400,
    );
  }

  const incomingKey = typeof payload.key === "string" ? payload.key.trim() : "";
  if (!incomingKey || incomingKey !== expectedApiKey) {
    return toJson(
      {
        ok: false,
        message: "无效的 key。",
      },
      401,
    );
  }

  const snapshot = toProcessReporterSnapshot(payload);
  if (!hasReadableStatus(snapshot)) {
    return toJson(
      {
        ok: false,
        message: "缺少有效状态字段（process/media/meta.description）。",
      },
      400,
    );
  }

  await saveProcessReporterSnapshot(snapshot);
  await emitProcessReporterUpdated(request, snapshot);

  return toJson({
    ok: true,
    data: snapshot,
    stale: false,
    enabled: true,
  });
}
