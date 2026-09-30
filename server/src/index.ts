import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { createDeps, shutdownDeps } from "./deps.js";

async function main() {
  for (const dir of [env.STATIC_AVATAR_DIR, env.STATIC_FILE_DIR, env.STATIC_CHUNK_DIR]) {
    mkdirSync(dir, { recursive: true });
  }

  const deps = createDeps();
  await deps.users.ensureYukinoUser();
  deps.hub.start();
  deps.agent.start();

  const { app, injectWebSocket } = createApp(deps);
  const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST });
  injectWebSocket(server);
  console.log(`yukino-chat server listening on ${env.HOST}:${env.PORT}`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("shutting down...");
    server.close();
    await shutdownDeps(deps);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});
