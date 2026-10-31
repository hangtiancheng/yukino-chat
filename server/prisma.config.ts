import "dotenv/config";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";
import { z } from "zod";

const databaseProviders = ["pg", "sqlite"] as const;

type DatabaseProvider = (typeof databaseProviders)[number];

const defaultDatabaseUrl = (provider: DatabaseProvider): string =>
  provider === "sqlite"
    ? "file:./prisma-sqlite/dev.db"
    : "postgresql://yukino:yukino@localhost:5432/yukino_chat";

const databaseUrlFor = (provider: DatabaseProvider, configuredUrl: string | undefined): string => {
  if (provider === "sqlite") {
    return configuredUrl?.startsWith("file:") ? configuredUrl : defaultDatabaseUrl(provider);
  }
  return configuredUrl && /^postgres(ql)?:\/\//.test(configuredUrl)
    ? configuredUrl
    : defaultDatabaseUrl(provider);
};

const resolveDatabaseUrl = (provider: DatabaseProvider, url: string): string => {
  if (provider !== "sqlite" || !url.startsWith("file:")) return url;
  return `file:${resolve(url.slice("file:".length))}`;
};

const prismaEnvSchema = z.object({
  DATABASE_PROVIDER: z.enum(databaseProviders).default("pg"),
  DATABASE_URL: z.string().min(1).optional(),
});

const prismaEnv = prismaEnvSchema.parse(process.env);
const isSqlite = prismaEnv.DATABASE_PROVIDER === "sqlite";

export default defineConfig({
  schema: isSqlite ? "prisma-sqlite/schema.prisma" : "prisma/schema.prisma",
  datasource: {
    url: resolveDatabaseUrl(
      prismaEnv.DATABASE_PROVIDER,
      databaseUrlFor(prismaEnv.DATABASE_PROVIDER, prismaEnv.DATABASE_URL),
    ),
  },
  migrations: {
    path: isSqlite ? "prisma-sqlite/migrations" : "prisma/migrations",
  },
});
