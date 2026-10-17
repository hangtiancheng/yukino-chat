import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import type { WebSocket } from "ws";
import type { AgentConnection, AgentRuntime } from "../agent/agent-runtime.js";
import {
  cancelSchema,
  ERROR_METHOD_NOT_FOUND,
  permissionResponseSchema,
  questionResponseSchema,
  type RpcResponse,
  rpcError,
  rpcSuccess,
} from "../agent/rpc-protocol.js";
import { parseToken } from "../common/jwt.js";
import { env } from "../config/env.js";
import type { Deps } from "../deps.js";
import type { AppEnv } from "../hono-env.js";

const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

interface IncomingRpc {
  jsonrpc: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export function registerAgentWsRoute(
  app: Hono<AppEnv>,
  deps: Deps,
  upgradeWebSocket: UpgradeWebSocket<WebSocket>,
) {
  app.get("/agent/ws", (c) => {
    const claims = parseToken(c.req.query("token") ?? "", env.JWT_SECRET);
    if (!claims) {
      return c.json({ code: 401, message: "invalid or expired token" });
    }
    const uuid = claims.uuid;
    // Held in the upgrade closure so onClose/onError can detach: without this
    // the runtime's connection slot is never released, connectionCount stays
    // above zero forever, and idle eviction can never reclaim the per-user
    // agent handle (a leak that grows with every distinct user).
    let conn: AgentConnection | null = null;
    let runtime: AgentRuntime | null = null;

    const detach = () => {
      if (runtime && conn) runtime.detach(conn);
      runtime = null;
      conn = null;
    };

    return upgradeWebSocket(c, {
      onOpen: async (_evt, wsCtx) => {
        const raw = wsCtx.raw;
        if (!raw) return;
        const connection: AgentConnection = {
          id: randomUUID(),
          lastSeen: Date.now(),
          send: (msg: object) => {
            if (raw.readyState === raw.OPEN) raw.send(JSON.stringify(msg));
          },
          close: (code?: number, reason?: string) => raw.close(code, reason),
          ping: () => {
            if (raw.readyState === raw.OPEN) {
              try {
                raw.ping();
              } catch {
                // Dead socket: the heartbeat sweep will drop it.
              }
            }
          },
          terminate: () => {
            try {
              raw.terminate();
            } catch {
              // Already gone.
            }
          },
        };
        conn = connection;
        // Any inbound frame or pong proves the socket is live.
        raw.on("pong", () => {
          connection.lastSeen = Date.now();
        });
        try {
          runtime = await deps.agent.getOrCreate(uuid);
          await runtime.attach(connection);
        } catch (err) {
          connection.send({
            jsonrpc: "2.0",
            method: "agent/error",
            params: {
              message:
                err instanceof Error ? err.message : "Yukino is not configured on this server",
            },
          });
        }
      },
      onMessage: async (evt, wsCtx) => {
        const raw = wsCtx.raw;
        if (!raw) return;
        if (conn) conn.lastSeen = Date.now();
        const data = evt.data;
        if (typeof data !== "string") return;
        if (Buffer.byteLength(data, "utf8") > MAX_MESSAGE_BYTES) {
          raw.send(
            JSON.stringify(
              rpcError(null, -32600, `message too large (max ${MAX_MESSAGE_BYTES} bytes)`),
            ),
          );
          return;
        }
        let frame: IncomingRpc;
        try {
          frame = JSON.parse(data) as IncomingRpc;
        } catch {
          raw.send(JSON.stringify(rpcError(null, -32700, "parse error")));
          return;
        }
        if (frame.jsonrpc !== "2.0" || typeof frame.method !== "string") {
          raw.send(JSON.stringify(rpcError(null, -32600, "invalid request")));
          return;
        }
        if (frame.id === undefined || frame.id === null) return;
        const id = frame.id as number | string;
        const response = await dispatchControl(deps, uuid, frame.method, frame.params, id);
        if (response) raw.send(JSON.stringify(response));
      },
      onClose: () => {
        detach();
      },
      onError: () => {
        detach();
      },
    });
  });
}

async function dispatchControl(
  deps: Deps,
  uuid: string,
  method: string,
  params: unknown,
  id: number | string,
): Promise<RpcResponse | null> {
  const objectParams =
    typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {};

  if (method === "ping") {
    return rpcSuccess(id);
  }

  let runtime: AgentRuntime;
  try {
    runtime = await deps.agent.getOrCreate(uuid);
  } catch (err) {
    return rpcError(id, -32000, err instanceof Error ? err.message : "agent unavailable");
  }

  switch (method) {
    case "permission/respond": {
      const parsed = permissionResponseSchema.safeParse(objectParams);
      if (!parsed.success) {
        return rpcError(id, -32602, "invalid params");
      }
      const applied = runtime.resolvePermission(parsed.data.id, parsed.data.response);
      return rpcSuccess(id, { applied });
    }
    case "question/respond": {
      const parsed = questionResponseSchema.safeParse(objectParams);
      if (!parsed.success) {
        return rpcError(id, -32602, "invalid params");
      }
      const applied = runtime.resolveQuestion(parsed.data.id, parsed.data.answers);
      return rpcSuccess(id, { applied });
    }
    case "session/cancel": {
      const parsed = cancelSchema.safeParse(objectParams);
      if (!parsed.success) {
        return rpcError(id, -32602, "invalid params");
      }
      runtime.cancel();
      return rpcSuccess(id);
    }
    default:
      return rpcError(id, ERROR_METHOD_NOT_FOUND, `method not found: ${method}`);
  }
}
