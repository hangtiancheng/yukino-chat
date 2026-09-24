import { createMiddleware } from "hono/factory";
import { forbidden } from "../common/envelope.js";
import type { Deps } from "../deps.js";
import type { AppEnv } from "../hono-env.js";
import { isAdmin } from "./auth.js";

export const requireAdmin = (deps: Deps) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const uuid = c.get("uuid") ?? "";
    if (!(await isAdmin(deps, uuid))) {
      return forbidden(c, "admin privilege required");
    }
    await next();
  });
