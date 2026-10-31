import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolveDatabaseUrl } from "../config/database.js";
import { env } from "../config/env.js";
import { PrismaClient as PgPrismaClient } from "../generated/prisma/client.js";
import { PrismaClient as SqlitePrismaClient } from "../generated/prisma-sqlite/client.js";

export const createPrismaClient = (databaseUrl = env.DATABASE_URL): PgPrismaClient => {
  if (env.DATABASE_PROVIDER === "sqlite") {
    const adapter = new PrismaBetterSqlite3({ url: resolveDatabaseUrl("sqlite", databaseUrl) });
    // The SQLite schema mirrors the Postgres models, so application code is typed against one client.
    return new SqlitePrismaClient({ adapter }) as unknown as PgPrismaClient;
  }
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PgPrismaClient({ adapter });
};

export type PrismaDB = ReturnType<typeof createPrismaClient>;
