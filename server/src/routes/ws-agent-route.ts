import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import type { WebSocket } from "ws";
import type { AgentRuntime } from "../agent/agent-runtime.js";
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

// JSON-RPC 2.0 bridge to the per-user agent runtime, mirroring the Go
// bridge's ws transport: server pushes notifications, client answers
// permissions/questions or cancels with unary requests.
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

    return upgradeWebSocket(c, {
      onOpen: async (_evt, wsCtx) => {
        const raw = wsCtx.raw;
        if (!raw) return;
        const conn = {
          id: randomUUID(),
          send: (msg: object) => {
            if (raw.readyState === raw.OPEN) raw.send(JSON.stringify(msg));
          },
          close: (code?: number, reason?: string) => raw.close(code, reason),
        };
        try {
          const runtime = await deps.agent.getOrCreate(uuid);
          await runtime.attach(conn);
        } catch (err) {
          conn.send({
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
        // Client→server notifications are silently ignored (Go parity).
        if (frame.id === undefined || frame.id === null) return;
        const id = frame.id as number | string;
        const response = await dispatchControl(deps, uuid, frame.method, frame.params, id);
        if (response) raw.send(JSON.stringify(response));
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
