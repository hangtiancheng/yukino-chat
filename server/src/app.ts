import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { env } from "./config/env.js";
import type { Deps } from "./deps.js";
import type { AppEnv } from "./hono-env.js";
import { authMiddleware } from "./middleware/auth.js";
import { corsMiddleware } from "./middleware/cors.js";
import { registerChatroomRoutes } from "./routes/chatroom-routes.js";
import { registerContactRoutes } from "./routes/contact-routes.js";
import { registerFileRoutes } from "./routes/file-routes.js";
import { registerGroupRoutes } from "./routes/group-routes.js";
import { registerLogRoutes } from "./routes/log-routes.js";
import { registerMessageRoutes } from "./routes/message-routes.js";
import { registerSessionRoutes } from "./routes/session-routes.js";
import { registerUserRoutes } from "./routes/user-routes.js";
import { registerAgentWsRoute } from "./routes/ws-agent-route.js";
import { registerWsChatRoute } from "./routes/ws-chat-route.js";
import { registerWsDashboardRoute } from "./routes/ws-dashboard-route.js";

const stripPrefix = (prefix: string) => (path: string) =>
  path.startsWith(prefix) ? path.slice(prefix.length) : path;

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.use("*", corsMiddleware);
  app.use("*", authMiddleware);
  app.onError((err, c) => {
    console.error("unhandled error:", err);
    return c.json({ code: 500, message: "Internal Server Error" });
  });

  // Liveness probe for container orchestration / reverse proxies (GET is
  // unauthenticated by design — see authMiddleware).
  app.get("/health", (c) => c.json({ status: "ok" }));

  // User-uploaded content. Served from the configured STATIC_* directories so
  // the env overrides actually take effect (writes already honor them).
  app.use(
    "/static/avatars/*",
    serveStatic({
      root: env.STATIC_AVATAR_DIR,
      rewriteRequestPath: stripPrefix("/static/avatars"),
    }),
  );
  app.use(
    "/static/files/*",
    serveStatic({ root: env.STATIC_FILE_DIR, rewriteRequestPath: stripPrefix("/static/files") }),
  );

  registerUserRoutes(app, deps);
  registerGroupRoutes(app, deps);
  registerSessionRoutes(app, deps);
  registerContactRoutes(app, deps);
  registerMessageRoutes(app, deps);
  registerFileRoutes(app);
  registerChatroomRoutes(app, deps);
  registerLogRoutes(app);

  registerWsChatRoute(app, deps, upgradeWebSocket);
  registerAgentWsRoute(app, deps, upgradeWebSocket);
  registerWsDashboardRoute(app, deps, upgradeWebSocket);

  // The frontend is NOT served from this process: the SPA is deployed
  // separately behind Nginx (see docker/nginx.conf.template), which
  // reverse-proxies every API/WS/upload path here.

  return { app, injectWebSocket };
}
