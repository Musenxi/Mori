"use client";

import { useEffect, useState } from "react";

import { getRealtimeSocket } from "@/lib/realtime-socket";
import { OnlinePresencePayload } from "@/lib/typecho-types";

const PRESENCE_ONLINE_EVENT = "presence:online";

function normalizeCount(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
}

export function SiteFooterPresence() {
  const [onlineCount, setOnlineCount] = useState<number | null>(null);

  useEffect(() => {
    let disposed = false;
    let socketRef: Awaited<ReturnType<typeof getRealtimeSocket>> | null = null;

    const handlePresence = (payload: OnlinePresencePayload) => {
      if (disposed) {
        return;
      }
      setOnlineCount(normalizeCount(payload?.count));
    };

    async function setupPresence() {
      try {
        const socket = await getRealtimeSocket();
        if (disposed) {
          return;
        }

        socketRef = socket;
        socket.on(PRESENCE_ONLINE_EVENT, handlePresence);
        socket.emit("presence:online:pull");
      } catch {
        // Ignore socket initialization errors and keep static footer fallback.
      }
    }

    void setupPresence();

    return () => {
      disposed = true;
      socketRef?.off(PRESENCE_ONLINE_EVENT, handlePresence);
    };
  }, []);

  return (
    <span>
      {onlineCount === null ? "正在被很多人看爆" : `正在被${onlineCount}人看爆`}
    </span>
  );
}
