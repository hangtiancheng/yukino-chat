import type { Hono } from "hono";
import { bindBody, num, optNum, str, strArr } from "../common/body.js";
import { back, RET_SYSTEM } from "../common/envelope.js";
import type { Deps } from "../deps.js";
import type { AppEnv } from "../hono-env.js";
import { requireAdmin } from "../middleware/admin.js";
import { tokenUUID } from "../middleware/auth.js";

export function registerGroupRoutes(app: Hono<AppEnv>, deps: Deps) {
  app.post("/group/create-group", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(
      c,
      await deps.groups.createGroup(
        str(body, "name"),
        tokenUUID(c),
        str(body, "avatar"),
        str(body, "notice"),
        num(body, "add_mode"),
        strArr(body, "member_ids"),
      ),
    );
  });

  app.post("/group/load-my-group", async (c) => {
    return back(c, await deps.groups.loadMyGroup(tokenUUID(c)));
  });

  app.post("/group/check-group-add-mode", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.groups.checkGroupAddMode(str(body, "group_id")));
  });

  app.post("/group/enter-group-directly", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.groups.enterGroupDirectly(tokenUUID(c), str(body, "group_id")));
  });

  app.post("/group/leave-group", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.groups.leaveGroup(tokenUUID(c), str(body, "group_id")));
  });

  app.post("/group/dismiss-group", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.groups.dismissGroup(tokenUUID(c), str(body, "group_id")));
  });

  app.post("/group/get-group-info", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.groups.getGroupInfo(str(body, "group_id")));
  });

  app.post("/group/update-group-info", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    const fields: Parameters<typeof deps.groups.updateGroupInfo>[2] = {};
    const name = str(body, "name");
    if (name !== "") fields.name = name;
    const notice = str(body, "notice");
    if (notice !== "") fields.notice = notice;
    const avatar = str(body, "avatar");
    if (avatar !== "") fields.avatar = avatar;
    const addMode = optNum(body, "add_mode");
    if (addMode !== null) fields.addMode = addMode;
    return back(c, await deps.groups.updateGroupInfo(tokenUUID(c), str(body, "uuid"), fields));
  });

  app.post("/group/get-group-member-list", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.groups.getGroupMemberList(str(body, "group_id")));
  });

  app.post("/group/remove-group-members", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(
      c,
      await deps.groups.removeGroupMembers(
        tokenUUID(c),
        str(body, "group_id"),
        strArr(body, "member_ids"),
      ),
    );
  });

  app.post("/group/invite-group-members", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    const memberIds = strArr(body, "member_ids");
    if (memberIds.length === 0) {
      return back(c, ["member_ids is required", null, -2]);
    }
    return back(c, await deps.groups.inviteGroupMembers(str(body, "group_id"), memberIds));
  });

  app.post("/group/search-group", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.groups.searchGroups(tokenUUID(c), str(body, "keyword")));
  });

  app.post("/group/get-group-info-list", requireAdmin(deps), async (c) => {
    return back(c, await deps.groups.getGroupInfoList());
  });

  app.post("/group/delete-groups", requireAdmin(deps), async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.groups.deleteGroups(strArr(body, "uuid_list")));
  });

  app.post("/group/set-groups-status", requireAdmin(deps), async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(
      c,
      await deps.groups.setGroupsStatus(strArr(body, "uuid_list"), num(body, "status")),
    );
  });
}
