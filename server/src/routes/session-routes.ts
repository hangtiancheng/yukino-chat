import type { Hono } from "hono";
import { bindBody, str } from "../common/body.js";
import { back, RET_SYSTEM } from "../common/envelope.js";
import type { Deps } from "../deps.js";
import type { AppEnv } from "../hono-env.js";
import { tokenUUID } from "../middleware/auth.js";

export function registerSessionRoutes(app: Hono<AppEnv>, deps: Deps) {
  app.post("/session/open-session", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.sessions.openSession(tokenUUID(c), str(body, "receive_id")));
  });

  app.post("/session/get-user-session-list", async (c) => {
    return back(c, await deps.sessions.getUserSessionList(tokenUUID(c)));
  });

  app.post("/session/get-group-session-list", async (c) => {
    return back(c, await deps.sessions.getGroupSessionList(tokenUUID(c)));
  });

  app.post("/session/delete-session", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.sessions.deleteSession(tokenUUID(c), str(body, "session_id")));
  });

  app.post("/session/check-open-session-allowed", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(
      c,
      await deps.sessions.checkOpenSessionAllowed(tokenUUID(c), str(body, "receive_id")),
    );
  });

  app.post("/session/mark-session-read", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.sessions.markSessionRead(tokenUUID(c), str(body, "receive_id")));
  });
}
