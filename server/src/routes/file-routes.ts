import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Hono } from "hono";
import { bindBody, type FormEntry, fileOf, num, str } from "../common/body.js";
import { back, RET_SYSTEM } from "../common/envelope.js";
import { env } from "../config/env.js";
import type { AppEnv } from "../hono-env.js";

const MAX_CHUNK_SIZE = 10 << 20;

const fileHashPattern = /^[a-fA-F0-9]{8,64}$/;
const extNamePattern = /^[a-zA-Z0-9]{1,10}$/;

const validateHashExt = (fileHash: string, extName: string) =>
  fileHashPattern.test(fileHash) && extNamePattern.test(extName);

const mergedFileName = (fileHash: string, extName: string) =>
  `${fileHash.toLowerCase()}.${extName.toLowerCase()}`;

const chunkDir = (fileHash: string) => path.join(env.STATIC_CHUNK_DIR, fileHash.toLowerCase());

export function registerFileRoutes(app: Hono<AppEnv>) {
  // Reports whether the file already exists (instant upload) or which chunk
  // indexes are still missing (resumable upload).
  app.post("/file/verify", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    const fileHash = str(body, "file_hash");
    const extName = str(body, "ext_name");
    const chunkCnt = num(body, "chunk_cnt");
    if (!validateHashExt(fileHash, extName) || chunkCnt <= 0) {
      return back(c, ["invalid file_hash, ext_name or chunk_cnt", -2]);
    }

    const finalName = mergedFileName(fileHash, extName);
    try {
      await stat(path.join(env.STATIC_FILE_DIR, finalName));
      return back(c, [
        "file already uploaded",
        { uploaded: true, url: `/static/files/${finalName}` },
        0,
      ]);
    } catch {
      // Not merged yet.
    }

    const dir = chunkDir(fileHash);
    const pending: number[] = [];
    for (let i = 0; i < chunkCnt; i++) {
      try {
        await stat(path.join(dir, `chunk-${i}`));
      } catch {
        pending.push(i);
      }
    }
    return back(c, ["success", { uploaded: false, pending_chunks: pending }, 0]);
  });

  // Stores a single multipart chunk under the chunk directory.
  app.post("/file/upload-chunk", async (c) => {
    let form: Record<string, FormEntry | undefined>;
    try {
      form = await c.req.parseBody();
    } catch {
      return back(c, ["invalid chunk metadata", -2]);
    }
    const fileHash = typeof form.file_hash === "string" ? form.file_hash : "";
    const extName = typeof form.ext_name === "string" ? form.ext_name : "";
    const chunkIdxRaw = typeof form.chunk_idx === "string" ? form.chunk_idx : "";
    const chunkIdx = Number.parseInt(chunkIdxRaw, 10);
    if (Number.isNaN(chunkIdx) || chunkIdx < 0 || !validateHashExt(fileHash, extName)) {
      return back(c, ["invalid chunk metadata", -2]);
    }
    const chunk = fileOf(form.chunk);
    if (!chunk) return back(c, ["chunk is required", -2]);
    if (chunk.size > MAX_CHUNK_SIZE) {
      return back(c, [`chunk too large (max ${MAX_CHUNK_SIZE >> 20} MB)`, -2]);
    }

    const dir = chunkDir(fileHash);
    try {
      await mkdir(dir, { recursive: true });
      const data = Buffer.from(await chunk.arrayBuffer());
      await writeFile(path.join(dir, `chunk-${chunkIdx}`), data);
    } catch {
      return back(c, ["failed to save chunk", -1]);
    }
    return back(c, ["chunk uploaded", 0]);
  });

  // Concatenates the uploaded chunks into the final file and removes the
  // chunk directory.
  app.post("/file/merge", async (c) => {
    const body = await bindBody(c);
    if (!body) return back(c, ["invalid request body", null, RET_SYSTEM]);
    const fileHash = str(body, "file_hash");
    const extName = str(body, "ext_name");
    const fileName = str(body, "file_name");
    if (!validateHashExt(fileHash, extName)) {
      return back(c, ["invalid file_hash or ext_name", -2]);
    }

    const finalName = mergedFileName(fileHash, extName);
    const finalPath = path.join(env.STATIC_FILE_DIR, finalName);
    const respond = (size: number) =>
      back(c, [
        "merge successful",
        { url: `/static/files/${finalName}`, file_name: fileName, file_size: String(size) },
        0,
      ]);

    const existing = await stat(finalPath).catch(() => null);
    if (existing) {
      return respond(existing.size);
    }

    const dir = chunkDir(fileHash);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return back(c, ["no chunks to merge", -2]);
    }
    const chunks: { idx: number; name: string }[] = [];
    for (const name of entries) {
      if (!name.startsWith("chunk-")) continue;
      const idx = Number.parseInt(name.slice(6), 10);
      if (Number.isNaN(idx)) continue;
      chunks.push({ idx, name });
    }
    if (chunks.length === 0) return back(c, ["no chunks to merge", -2]);
    chunks.sort((a, b) => a.idx - b.idx);

    await mkdir(env.STATIC_FILE_DIR, { recursive: true });
    let total = 0;
    const parts: Buffer[] = [];
    for (const ch of chunks) {
      try {
        const data = await readFile(path.join(dir, ch.name));
        parts.push(data);
        total += data.byteLength;
      } catch {
        // Delete the partial final so a later verify does not report an
        // instant-upload success for a truncated file.
        await rm(finalPath, { force: true });
        return back(c, ["failed to merge file", -1]);
      }
    }
    try {
      await writeFile(finalPath, Buffer.concat(parts));
    } catch {
      return back(c, ["failed to merge file", -1]);
    }
    await rm(dir, { recursive: true, force: true });
    return respond(total);
  });
}
