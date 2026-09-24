import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import type { WebSocket } from "ws";
import { parseToken } from "../common/jwt.js";
import { env } from "../config/env.js";
import type { Deps } from "../deps.js";
import type { AppEnv } from "../hono-env.js";
import type { ClientConn } from "../hub/chat-hub.js";
import { MessagePipeline } from "../hub/message-pipeline.js";

export function registerWsChatRoute(
  app: Hono<AppEnv>,
  deps: Deps,
  upgradeWebSocket: UpgradeWebSocket<WebSocket>,
) {
  const pipeline = new MessagePipeline(deps);

  app.get("/wss", (c) => {
    const claims = parseToken(c.req.query("token") ?? "", env.JWT_SECRET);
    if (!claims) {
      return c.json({ code: 401, message: "invalid or expired token" });
    }
    // Trusting a client-supplied id would let anyone who knows a uuid evict
    // that user's socket and receive their messages.
    const clientId = c.req.query("client_id") ?? "";
    if (clientId !== "" && clientId !== claims.uuid) {
      return c.json({ code: 403, message: "client_id does not match the token" });
    }
    const uuid = claims.uuid;
    let conn: ClientConn | null = null;

    return upgradeWebSocket(c, {
      onOpen: (_evt, wsCtx) => {
        const raw = wsCtx.raw;
        if (!raw) return;
        conn = { uuid, ws: raw, alive: true, lastSeen: Date.now() };
        raw.on("pong", () => {
          if (conn) {
            conn.alive = true;
            conn.lastSeen = Date.now();
          }
        });
        deps.hub.register(conn);
      },
      onMessage: (evt) => {
        if (conn) {
          conn.alive = true;
          conn.lastSeen = Date.now();
        }
        const data = evt.data;
        if (typeof data !== "string") return;
        pipeline.handleFrame(uuid, data);
      },
      onClose: () => {
        if (conn) {
          deps.hub.unregister(conn);
          conn = null;
        }
      },
    });
  });
}
