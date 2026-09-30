import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import type { WebSocket } from "ws";
import type { Deps } from "../deps.js";
import type { AppEnv } from "../hono-env.js";
import { isAdmin, wsTokenUUID } from "../middleware/auth.js";

const SNAPSHOT_INTERVAL_MS = 2000;

// Admin cache dashboard: pushes cache snapshot frames (mirroring the Go
// yukino_cache dashboard protocol) and accepts key deletions.
export function registerWsDashboardRoute(
  app: Hono<AppEnv>,
  deps: Deps,
  upgradeWebSocket: UpgradeWebSocket<WebSocket>,
) {
  app.get("/dashboard/ws", (c) => {
    const uuid = wsTokenUUID(c);
    if (!uuid) {
      return c.json({ code: 401, message: "invalid or expired token" });
    }
    return (async () => {
      if (!(await isAdmin(deps, uuid))) {
        return c.json({ code: 403, message: "admin privilege required" });
      }
      return upgradeWebSocket(c, {
        onOpen: async (_evt, wsCtx) => {
          const raw = wsCtx.raw;
          if (!raw) return;
          let timer: NodeJS.Timeout | null = null;
          const push = async () => {
            try {
              const snapshot = await deps.cache.snapshot();
              if (raw.readyState === raw.OPEN) raw.send(JSON.stringify(snapshot));
            } catch {
              // Best-effort.
            }
          };
          await push();
          timer = setInterval(() => void push(), SNAPSHOT_INTERVAL_MS);
          raw.once("close", () => {
            if (timer) clearInterval(timer);
          });
        },
        onMessage: async (evt) => {
          const data = evt.data;
          if (typeof data !== "string") return;
          try {
            const cmd = JSON.parse(data) as { action?: string; group?: string; key?: string };
            if (cmd.action === "delete" && cmd.group && cmd.key) {
              await deps.cache.deleteKey(cmd.group, cmd.key);
            }
          } catch {
            // Ignore malformed commands.
          }
        },
      });
    })();
  });
}
