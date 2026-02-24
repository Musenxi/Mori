"use client";

import type { Socket } from "socket.io-client";

let socketInstance: Socket | null = null;
let socketPromise: Promise<Socket> | null = null;

export async function getRealtimeSocket() {
  if (socketInstance) {
    return socketInstance;
  }

  if (!socketPromise) {
    socketPromise = import("socket.io-client")
      .then(({ io }) => {
        socketInstance = io({
          path: "/socket.io",
          transports: ["websocket", "polling"],
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
