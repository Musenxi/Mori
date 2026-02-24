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
    });

    server.listen(port, host, () => {
      console.log(`> Ready on http://${host}:${port}`);
    });
  })
  .catch((error) => {
    console.error("> Failed to start server", error);
    process.exit(1);
  });
