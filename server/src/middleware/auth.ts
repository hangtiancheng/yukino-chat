import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { CachedUser } from "../cache/cache-service.js";
import { authError } from "../common/envelope.js";
import { parseToken } from "../common/jwt.js";
import { env } from "../config/env.js";
import type { Deps } from "../deps.js";
import type { AppEnv } from "../hono-env.js";

const PUBLIC_PATHS = new Set(["/login", "/register", "/user/update-password"]);

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method !== "POST" || PUBLIC_PATHS.has(c.req.path)) {
    await next();
    return;
  }
  const token = (c.req.header("Authorization") ?? "").replace(/^Bearer /, "");
  if (!token) return authError(c, "missing token");
  const claims = parseToken(token, env.JWT_SECRET);
  if (!claims) return authError(c, "invalid or expired token");
  c.set("uuid", claims.uuid);
  await next();
});

export function tokenUUID(c: Context<AppEnv>): string {
  return c.get("uuid") ?? "";
}

// WS handshakes carry their token in the query string (browsers cannot set
// headers during an upgrade). Returns the uuid or null.
export function wsTokenUUID(c: Context): string | null {
  const claims = parseToken(c.req.query("token") ?? "", env.JWT_SECRET);
  return claims?.uuid ?? null;
}

export async function isAdmin(deps: Deps, uuid: string): Promise<boolean> {
  if (uuid === "") return false;
  const cached = await deps.cache.getUser<CachedUser>(uuid);
  if (cached) return cached.is_admin === 1;
  const user = await deps.db.userInfo.findFirst({
    where: { uuid, deletedAt: null },
    select: { isAdmin: true },
  });
  return user?.isAdmin === 1;
}
