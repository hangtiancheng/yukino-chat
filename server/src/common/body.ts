import type { Context } from "hono";

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

export const optStr = (o: Record<string, unknown>, k: string): string | null =>
  typeof o[k] === "string" ? (o[k] as string) : null;

export const optNum = (o: Record<string, unknown>, k: string): number | null =>
  typeof o[k] === "number" ? (o[k] as number) : null;

export type FormEntry = string | File;

export const fileOf = (v: FormEntry | undefined): File | null => (v instanceof File ? v : null);
