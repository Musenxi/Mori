"use client";

import type { Socket } from "socket.io-client";

const PRESENCE_VIEWER_ID_KEY = "mori:presence:viewer-id";

let socketInstance: Socket | null = null;
let socketPromise: Promise<Socket> | null = null;

function createViewerId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function resolvePresenceViewerId() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const stored = window.localStorage.getItem(PRESENCE_VIEWER_ID_KEY)?.trim() ?? "";
    if (stored) {
      return stored;
    }

    const created = createViewerId();
    window.localStorage.setItem(PRESENCE_VIEWER_ID_KEY, created);
    return created;
  } catch {
    return "";
  }
}

export async function getRealtimeSocket() {
  if (socketInstance) {
    return socketInstance;
  }

  if (!socketPromise) {
    socketPromise = import("socket.io-client")
      .then(({ io }) => {
        const viewerId = resolvePresenceViewerId();

        socketInstance = io({
          path: "/socket.io",
          transports: ["websocket", "polling"],
          auth: viewerId ? { viewerId } : undefined,
        });
        return socketInstance;
      })
      .catch((error) => {
        socketPromise = null;
        throw error;
      });
  }

  return socketPromise;
}
