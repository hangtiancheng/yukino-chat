import type { Context } from "hono";

// Every response is HTTP 200; the real status lives in the body. `data` is
// only present on code 200: pass `undefined` to omit it, `null` to emit
// "data": null (Go emits null for empty-but-typed lists).
export const ok = (c: Context, message: string, data?: unknown) =>
  data === undefined ? c.json({ code: 200, message }) : c.json({ code: 200, message, data });

export const paramError = (c: Context, message: string) => c.json({ code: 400, message });

export const serverError = (c: Context, message = "Internal Server Error") =>
  c.json({ code: 500, message });

export const authError = (c: Context, message: string) => c.json({ code: 401, message });

export const forbidden = (c: Context, message: string) => c.json({ code: 403, message });

export const rateLimited = (c: Context) =>
  c.json({ code: 429, message: "too many requests, slow down" });

// Result triple mirroring the Go (message, data, ret) convention. Services
// without a data payload return the 2-tuple (message, ret).
export type Ret<T> = [string, T, number];
export type RetVoid = [string, number];

export const RET_OK = 0;
export const RET_PARAM = -2;
export const RET_SYSTEM = -1;

export function back(c: Context, result: [string, unknown, number] | [string, number]) {
  if (result.length === 2) {
    return finish(c, result[0], undefined, result[1]);
  }
  return finish(c, result[0], result[1], result[2]);
}

function finish(c: Context, message: string, data: unknown, ret: number) {
  if (ret === RET_OK) {
    // Go builds lists by appending to a nil slice: an empty result serializes
    // as "data": null, never [].
    const normalized = Array.isArray(data) && data.length === 0 ? null : data;
    return ok(c, message, normalized);
  }
  if (ret === RET_PARAM) return paramError(c, message);
  return serverError(c, message);
}
