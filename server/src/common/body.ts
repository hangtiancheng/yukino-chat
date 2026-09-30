import type { Context } from "hono";

// Parses the JSON body mirroring Go's BindJSON zero-value semantics: unknown
// fields ignored, wrong/missing fields fall back to defaults. Returns null for
// bodies that are not JSON objects (handlers answer "invalid request body").
export async function bindBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await c.req.json();
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export const str = (o: Record<string, unknown>, k: string): string =>
  typeof o[k] === "string" ? (o[k] as string) : "";

export const num = (o: Record<string, unknown>, k: string): number =>
  typeof o[k] === "number" ? (o[k] as number) : 0;

export const strArr = (o: Record<string, unknown>, k: string): string[] =>
  Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === "string") : [];

// Pointer semantics: null means "absent", so callers distinguish "field not
// sent" from "field sent as empty string".
export const optStr = (o: Record<string, unknown>, k: string): string | null =>
  typeof o[k] === "string" ? (o[k] as string) : null;

export const optNum = (o: Record<string, unknown>, k: string): number | null =>
  typeof o[k] === "number" ? (o[k] as number) : null;

// DOM's FormDataEntryValue is unavailable without the DOM lib; @types/node
// provides the File global.
export type FormEntry = string | File;

export const fileOf = (v: FormEntry | undefined): File | null => (v instanceof File ? v : null);
