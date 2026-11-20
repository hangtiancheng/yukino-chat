import { env } from "../config/env.js";

/**
 * SQLite's `LIKE` is already case-insensitive for ASCII and its Prisma client
 * rejects the PostgreSQL-only `mode` argument. PostgreSQL keeps an explicit
 * insensitive mode so the behavior stays independent of its collation.
 */
export const insensitiveContains = (value: string): { contains: string; mode?: "insensitive" } =>
  env.DATABASE_PROVIDER === "sqlite"
    ? { contains: value }
    : { contains: value, mode: "insensitive" };
