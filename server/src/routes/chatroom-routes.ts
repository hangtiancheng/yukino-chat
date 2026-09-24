import type { Hono } from "hono";
import { bindBody, str } from "../common/body.js";
import { back, RET_SYSTEM } from "../common/envelope.js";
import type { Deps } from "../deps.js";
import type { AppEnv } from "../hono-env.js";
import { tokenUUID } from "../middleware/auth.js";

export function registerChatroomRoutes(app: Hono<AppEnv>, deps: Deps) {
  app.post("/chatroom/get-online-users", async (c) => {
    return back(c, ["success", deps.hub.getOnlineUserList(), 0]);
  });

  app.post("/chatroom/get-callers", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    const roomId = str(body, "room_id");
    if (roomId === "") return back(c, ["room_id is required", null, -2]);
    const uuid = tokenUUID(c);
    if (!(await canSeeCallRoom(deps, roomId, uuid))) {
      return back(c, ["you cannot view this call room", null, -2]);
    }
    const callers = deps.calls.members(roomId).filter((m) => m !== uuid);
    return back(c, ["success", callers, 0]);
  });
}

// The user is already in the room, the room is their own 1v1 pair room, or
// the room is a group they belong to.
async function canSeeCallRoom(deps: Deps, roomId: string, uuid: string): Promise<boolean> {
  if (uuid === "" || roomId === "") return false;
  if (deps.calls.inRoom(roomId, uuid)) return true;
  if (roomId.startsWith("P:")) {
    return roomId.slice(2).split(":").includes(uuid);
  }
  if (!roomId.startsWith("G")) return false;
  const group = await deps.db.groupInfo.findFirst({
    where: { uuid: roomId, deletedAt: null },
  });
  return group?.members.includes(uuid) ?? false;
}
