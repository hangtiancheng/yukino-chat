import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { env } from "../config/env.js";
import type { AppEnv } from "../hono-env.js";

/**
 * Minimal Sentry telemetry ingest. The client SDK is initialized with
 * `dsn: "/api/log"`; Nginx strips the `/api` prefix, so the batch lands here
 * as `POST /log`. Each batch (a JSON array of report events) is appended as a
 * single JSONL line under `<SENTRY_LOG_DIR>/<YYYY-MM>/sentry.jsonl`.
 *
 * This is deliberately lightweight — for high-volume deployments point the
 * dsn at the dedicated `@yukino.js/sentry` ingest server instead.
 */
export function registerLogRoutes(app: Hono<AppEnv>) {
  // The SDK probes the endpoint with HEAD to detect server recovery.
  app.on("HEAD", "/log", (c) => c.body(null, 204));

  app.post("/log", async (c) => {
    let events: unknown;
    try {
      events = await c.req.json();
    } catch {
      return c.body(null, 400);
    }
    if (!Array.isArray(events) || events.length === 0) {
      return c.body(null, 400);
    }
    try {
      const month = new Date().toISOString().slice(0, 7); // YYYY-MM
      const dir = join(env.SENTRY_LOG_DIR, month);
      await mkdir(dir, { recursive: true });
      await appendFile(join(dir, "sentry.jsonl"), `${JSON.stringify(events)}\n`, "utf8");
    } catch (err) {
      console.error("sentry ingest write failed:", err);
      return c.body(null, 500);
    }
    return c.body(null, 204);
  });
}
