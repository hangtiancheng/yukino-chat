import type { MiddlewareHandler } from "hono";

// Mirror of the Go CORS middleware: permissive headers, OPTIONS → 204.
export const corsMiddleware: MiddlewareHandler = async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Origin, Content-Length, Content-Type, Authorization");
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }
  await next();
};
