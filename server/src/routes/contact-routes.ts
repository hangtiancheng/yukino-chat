import type { Hono } from "hono";
import { bindBody, num, optStr, str } from "../common/body.js";
import { back, RET_SYSTEM } from "../common/envelope.js";
import type { Deps } from "../deps.js";
import type { AppEnv } from "../hono-env.js";
import { tokenUUID } from "../middleware/auth.js";

export function registerContactRoutes(app: Hono<AppEnv>, deps: Deps) {
  app.post("/contact/get-user-list", async (c) => {
    return back(c, await deps.contacts.getUserList(tokenUUID(c)));
  });

  app.post("/contact/get-tag-list", async (c) => {
    return back(c, await deps.contacts.getTagList(tokenUUID(c)));
  });

  app.post("/contact/add-tag", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.contacts.addTag(tokenUUID(c), str(body, "name")));
  });

  app.post("/contact/update-contact", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(
      c,
      await deps.contacts.updateContact(
        tokenUUID(c),
        str(body, "contact_id"),
        optStr(body, "note_name"),
        optStr(body, "tag_id"),
      ),
    );
  });

  app.post("/contact/load-my-joined-group", async (c) => {
    return back(c, await deps.contacts.loadMyJoinedGroup(tokenUUID(c)));
  });

  app.post("/contact/get-contact-info", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.contacts.getContactInfo(tokenUUID(c), str(body, "contact_id")));
  });

  app.post("/contact/apply-contact", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(
      c,
      await deps.contacts.applyContact(
        tokenUUID(c),
        str(body, "contact_id"),
        num(body, "contact_type"),
        str(body, "message"),
      ),
    );
  });

  app.post("/contact/get-new-contact-list", async (c) => {
    return back(c, await deps.contacts.getNewContactList(tokenUUID(c)));
  });

  app.post("/contact/pass-contact-apply", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.contacts.passContactApply(tokenUUID(c), str(body, "apply_id")));
  });

  app.post("/contact/refuse-contact-apply", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.contacts.refuseContactApply(tokenUUID(c), str(body, "apply_id")));
  });

  app.post("/contact/black-apply", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.contacts.blackApply(tokenUUID(c), str(body, "apply_id")));
  });

  app.post("/contact/black-contact", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.contacts.blackContact(tokenUUID(c), str(body, "contact_id")));
  });

  app.post("/contact/cancel-black-contact", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.contacts.cancelBlackContact(tokenUUID(c), str(body, "contact_id")));
  });

  app.post("/contact/delete-contact", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.contacts.deleteContact(tokenUUID(c), str(body, "contact_id")));
  });

  app.post("/contact/get-add-group-list", async (c) => {
    return back(c, await deps.contacts.getAddGroupList(tokenUUID(c)));
  });
}
