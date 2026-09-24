import type { Context, MiddlewareHandler } from "hono";
import { rateLimited } from "../common/envelope.js";

function clientIP(c: Context): string {
  const fwd = c.req.header("X-Forwarded-For");
  if (fwd) {
    const first = fwd.split(",")[0];
    if (first) return first.trim();
    return fwd.trim();
  }
  const incoming = c.env.incoming;
  const addr = incoming.socket.remoteAddress;
  return addr ?? "unknown";
}

// Per-IP sliding window, per middleware instance (Go parity: /login and
// /register each get their own bucket).
export const rateLimit = (max: number, windowMs: number): MiddlewareHandler => {
  const hits = new Map<string, number[]>();

  return async (c, next) => {
    const ip = clientIP(c);
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(ip, recent);
      return rateLimited(c);
    }
    recent.push(now);
    hits.set(ip, recent);
    await next();
  };
};
