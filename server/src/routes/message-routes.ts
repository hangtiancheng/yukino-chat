import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Hono } from "hono";
import { bindBody, type FormEntry, fileOf, str } from "../common/body.js";
import { back, RET_SYSTEM } from "../common/envelope.js";
import { randomId } from "../common/ids.js";
import { env } from "../config/env.js";
import type { Deps } from "../deps.js";
import type { AppEnv } from "../hono-env.js";
import { tokenUUID } from "../middleware/auth.js";

const MAX_AVATAR_SIZE = 5 << 20;
const MAX_FILE_SIZE = 50 << 20;
const AVATAR_EXT_WHITELIST = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

// Strips any path components and keeps only a safe character set, preventing
// path traversal via the uploaded filename.
export function sanitizeFilename(name: string): string {
  name = path.basename(name);
  let out = "";
  for (const ch of name) {
    out += /[a-zA-Z0-9.\-_]/.test(ch) ? ch : "_";
  }
  out = out.replace(/^\.+|\.+$/g, "");
  return out === "" ? "file" : out;
}

interface SavedUpload {
  filename: string;
  origName: string;
  size: number;
}

async function saveUpload(
  file: File,
  dir: string,
  maxSize: number,
  extWhitelist: Set<string> | null,
): Promise<SavedUpload | { error: [string, number] }> {
  if (file.size > maxSize) {
    return { error: [`file too large (max ${maxSize >> 20} MB)`, -2] };
  }
  const safeName = sanitizeFilename(file.name ?? "");
  if (extWhitelist) {
    const ext = path.extname(safeName).toLowerCase();
    if (!extWhitelist.has(ext)) {
      return { error: ["unsupported file type", -2] };
    }
  }
  await mkdir(dir, { recursive: true });
  const filename = `${randomId(8)}_${safeName}`;
  const dst = path.join(dir, filename);
  try {
    // Stream to disk to avoid buffering 50 MiB uploads in memory.
    await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(dst));
  } catch {
    return { error: ["failed to save file", -1] };
  }
  return { filename, origName: file.name ?? "", size: file.size };
}

export function registerMessageRoutes(app: Hono<AppEnv>, deps: Deps) {
  app.post("/message/get-message-list", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.messages.getMessageList(tokenUUID(c), str(body, "receive_id")));
  });

  app.post("/message/get-group-message-list", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    return back(c, await deps.messages.getGroupMessageList(tokenUUID(c), str(body, "group_id")));
  });

  app.post("/message/upload-avatar", async (c) => {
    let form: Record<string, FormEntry | undefined>;
    try {
      form = await c.req.parseBody();
    } catch {
      return back(c, ["file is required", -2]);
    }
    const file = fileOf(form.file);
    if (!file) return back(c, ["file is required", -2]);
    const saved = await saveUpload(
      file,
      env.STATIC_AVATAR_DIR,
      MAX_AVATAR_SIZE,
      AVATAR_EXT_WHITELIST,
    );
    if ("error" in saved) return back(c, saved.error);
    return back(c, ["upload successful", { url: `/static/avatars/${saved.filename}` }, 0]);
  });

  app.post("/message/upload-file", async (c) => {
    let form: Record<string, FormEntry | undefined>;
    try {
      form = await c.req.parseBody();
    } catch {
      return back(c, ["file is required", -2]);
    }
    const file = fileOf(form.file);
    if (!file) return back(c, ["file is required", -2]);
    const saved = await saveUpload(file, env.STATIC_FILE_DIR, MAX_FILE_SIZE, null);
    if ("error" in saved) return back(c, saved.error);
    return back(c, [
      "upload successful",
      {
        url: `/static/files/${saved.filename}`,
        file_name: saved.origName,
        file_size: String(saved.size),
      },
      0,
    ]);
  });
}
