import http from "node:http";

import nextEnv from "@next/env";
import next from "next";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), dev);

const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3000", 10);
const SOCKET_INTERNAL_TOKEN = process.env.SOCKET_INTERNAL_TOKEN?.trim() || "mori-local-socket-token";
const INTERNAL_BROADCAST_PATH = "/internal/socket-broadcast";
const PRESENCE_ONLINE_EVENT = "presence:online";
const PRESENCE_POST_READING_EVENT = "presence:post-reading";
const PROCESS_REPORTER_SOCKET_ROOM = "process-reporter:watchers";

function normalizePostTarget(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object") {
    return { cid: undefined, slug: undefined };
  }

  const payload = rawPayload;
  const cidParsed = Number.parseInt(String(payload.cid ?? ""), 10);
  const cid = Number.isFinite(cidParsed) && cidParsed > 0 ? cidParsed : undefined;
  const slug = typeof payload.slug === "string" ? payload.slug.trim() : "";

  return {
    cid,
    slug: slug || undefined,
  };
}

function buildPostRooms(target) {
  const rooms = [];

  if (target.cid) {
    rooms.push(`post:${target.cid}`);
  }

  if (target.slug) {
    rooms.push(`post:slug:${target.slug}`);
  }

  return rooms;
}

function buildPresenceRoom(target) {
  if (target.cid) {
    return `presence:post:${target.cid}`;
  }

  if (target.slug) {
    return `presence:post:slug:${target.slug}`;
  }

  return "";
}

function normalizeViewerId(rawValue) {
  if (typeof rawValue !== "string") {
    return "";
  }

  const value = rawValue.trim();
  if (!value) {
    return "";
  }

  return value.slice(0, 128);
}

function getSocketViewerId(socket) {
  const viewerId = typeof socket?.data?.viewerId === "string" ? socket.data.viewerId : "";
  return viewerId || socket.id;
}

function getOnlineCount(io) {
  const viewers = new Set();

  io.of("/").sockets.forEach((activeSocket) => {
    viewers.add(getSocketViewerId(activeSocket));
  });

  return viewers.size;
}

function emitOnlinePresence(io) {
  io.emit(PRESENCE_ONLINE_EVENT, {
    count: getOnlineCount(io),
  });
}

function emitPostReadingPresence(io, room, target) {
  if (!room || !target) {
    return;
  }

  const roomSockets = io.sockets.adapter.rooms.get(room);
  const viewers = new Set();

  roomSockets?.forEach((socketId) => {
    const roomSocket = io.of("/").sockets.get(socketId);
    if (!roomSocket) {
      return;
    }

    viewers.add(getSocketViewerId(roomSocket));
  });

  const count = viewers.size;
  io.to(room).emit(PRESENCE_POST_READING_EVENT, {
    cid: target.cid ?? null,
    slug: target.slug ?? null,
    count,
  });
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const app = next({ dev, hostname: host, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = http.createServer(async (req, res) => {
      if (req.url?.startsWith(INTERNAL_BROADCAST_PATH)) {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, message: "Method Not Allowed" });
          return;
        }

        const token = req.headers["x-mori-socket-token"];
        if (token !== SOCKET_INTERNAL_TOKEN) {
          sendJson(res, 401, { ok: false, message: "Unauthorized" });
          return;
        }

        try {
          const body = await parseJsonBody(req);
          const event = typeof body?.event === "string" ? body.event : "";
          const rooms = Array.isArray(body?.rooms)
            ? body.rooms.filter((room) => typeof room === "string" && room.trim())
            : [];

          if (!event || rooms.length === 0) {
            sendJson(res, 400, { ok: false, message: "Invalid payload" });
            return;
          }

          const uniqueRooms = Array.from(new Set(rooms));
          uniqueRooms.forEach((room) => {
            io.to(room).emit(event, body.payload ?? null);
          });

          sendJson(res, 200, { ok: true });
          return;
        } catch {
          sendJson(res, 400, { ok: false, message: "Invalid JSON body" });
          return;
        }
      }

      handle(req, res);
    });

    const io = new Server(server, {
      path: "/socket.io",
      cors: {
        origin: true,
        credentials: true,
      },
    });

    io.on("connection", (socket) => {
      const authViewerId = normalizeViewerId(socket.handshake?.auth?.viewerId);
      const queryViewerId = normalizeViewerId(socket.handshake?.query?.viewerId);
      socket.data.viewerId = authViewerId || queryViewerId || socket.id;
      socket.data.presenceRoom = null;
      socket.data.presenceTarget = null;
      emitOnlinePresence(io);

      socket.on("post:join", (rawPayload) => {
        const target = normalizePostTarget(rawPayload);
        buildPostRooms(target).forEach((room) => {
          socket.join(room);
        });
      });

      socket.on("post:leave", (rawPayload) => {
        const target = normalizePostTarget(rawPayload);
        buildPostRooms(target).forEach((room) => {
          socket.leave(room);
        });
      });

      socket.on("presence:join", (rawPayload) => {
        const target = normalizePostTarget(rawPayload);
        const nextRoom = buildPresenceRoom(target);
        if (!nextRoom) {
          return;
        }

        const prevRoom = typeof socket.data.presenceRoom === "string" ? socket.data.presenceRoom : "";
        const prevTarget =
          socket.data.presenceTarget && typeof socket.data.presenceTarget === "object"
            ? socket.data.presenceTarget
            : null;

        if (prevRoom && prevRoom !== nextRoom) {
          socket.leave(prevRoom);
          emitPostReadingPresence(io, prevRoom, prevTarget);
        }

        if (prevRoom !== nextRoom) {
          socket.join(nextRoom);
        }

        socket.data.presenceRoom = nextRoom;
        socket.data.presenceTarget = target;
        emitPostReadingPresence(io, nextRoom, target);
      });

      socket.on("presence:online:pull", () => {
        socket.emit(PRESENCE_ONLINE_EVENT, {
          count: getOnlineCount(io),
        });
      });

      socket.on("presence:leave", (rawPayload) => {
        const currentRoom = typeof socket.data.presenceRoom === "string" ? socket.data.presenceRoom : "";
        const currentTarget =
          socket.data.presenceTarget && typeof socket.data.presenceTarget === "object"
            ? socket.data.presenceTarget
            : null;

        if (!currentRoom || !currentTarget) {
          return;
        }

        const target = normalizePostTarget(rawPayload);
        if (target.cid || target.slug) {
          const sameCid = target.cid && currentTarget.cid && target.cid === currentTarget.cid;
          const sameSlug = target.slug && currentTarget.slug && target.slug === currentTarget.slug;
          if (!sameCid && !sameSlug) {
            return;
          }
        }

        socket.leave(currentRoom);
        socket.data.presenceRoom = null;
        socket.data.presenceTarget = null;
        emitPostReadingPresence(io, currentRoom, currentTarget);
      });

      socket.on("process-reporter:watch", () => {
        socket.join(PROCESS_REPORTER_SOCKET_ROOM);
      });

      socket.on("process-reporter:unwatch", () => {
        socket.leave(PROCESS_REPORTER_SOCKET_ROOM);
      });

      socket.on("disconnect", () => {
        const room = typeof socket.data.presenceRoom === "string" ? socket.data.presenceRoom : "";
        const target =
          socket.data.presenceTarget && typeof socket.data.presenceTarget === "object"
            ? socket.data.presenceTarget
            : null;

        socket.data.presenceRoom = null;
        socket.data.presenceTarget = null;

        if (room && target) {
          emitPostReadingPresence(io, room, target);
        }
        emitOnlinePresence(io);
      });
    });

    server.listen(port, host, () => {
      console.log(`> Ready on http://${host}:${port}`);
    });
  })
  .catch((error) => {
    console.error("> Failed to start server", error);
    process.exit(1);
  });
