import type { Hono } from "hono";
import { bindBody, num, str, strArr } from "../common/body.js";
import { back, RET_SYSTEM } from "../common/envelope.js";
import type { Deps } from "../deps.js";
import type { AppEnv } from "../hono-env.js";
import { requireAdmin } from "../middleware/admin.js";
import { tokenUUID } from "../middleware/auth.js";
import { rateLimit } from "../middleware/ratelimit.js";

export function registerUserRoutes(app: Hono<AppEnv>, deps: Deps) {
  app.post("/login", rateLimit(10, 60_000), async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.users.login(str(body, "telephone"), str(body, "password")));
  });

  app.post("/register", rateLimit(10, 60_000), async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(
      c,
      await deps.users.register(
        str(body, "telephone"),
        str(body, "password"),
        str(body, "nickname"),
      ),
    );
  });

  app.post("/user/update-password", rateLimit(5, 60_000), async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    const telephone = str(body, "telephone");
    const password = str(body, "password");
    if (telephone === "" || password === "") {
      return back(c, ["telephone and password are required", null, -2]);
    }
    return back(c, await deps.users.updatePassword(telephone, password));
  });

  app.post("/user/search-user", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.users.searchUsers(tokenUUID(c), str(body, "keyword")));
  });

  app.post("/user/update-user-info", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    const fields: Parameters<typeof deps.users.updateUserInfo>[1] = {};
    const nickname = str(body, "nickname");
    if (nickname !== "") fields.nickname = nickname;
    const email = str(body, "email");
    if (email !== "") fields.email = email;
    const birthday = str(body, "birthday");
    if (birthday !== "") fields.birthday = birthday;
    const signature = str(body, "signature");
    if (signature !== "") fields.signature = signature;
    const avatar = str(body, "avatar");
    if (avatar !== "") fields.avatar = avatar;
    return back(c, await deps.users.updateUserInfo(tokenUUID(c), fields));
  });

  app.post("/user/get-user-info", async (c) => {
    return back(c, await deps.users.getUserInfo(tokenUUID(c)));
  });

  app.post("/user/get-user-info-list", requireAdmin(deps), async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.users.getUserInfoList(str(body, "owner_id")));
  });

  app.post("/user/able-users", requireAdmin(deps), async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.users.ableUsers(strArr(body, "uuid_list")));
  });

  app.post("/user/disable-users", requireAdmin(deps), async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.users.disableUsers(strArr(body, "uuid_list")));
  });

  app.post("/user/delete-users", requireAdmin(deps), async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.users.deleteUsers(strArr(body, "uuid_list")));
  });

  app.post("/user/set-admin", requireAdmin(deps), async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.users.setAdmin(strArr(body, "uuid_list"), num(body, "is_admin")));
  });

  app.post("/user/ws-logout", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    const uuid = tokenUUID(c);
    const ownerId = str(body, "owner_id");
    if (ownerId !== "" && ownerId !== uuid) {
      return c.json({ code: 403, message: "owner_id does not match the token" });
    }
    deps.hub.logout(uuid);
    return back(c, ["logout successful", null, 0]);
  });
}
