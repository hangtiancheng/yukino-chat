import { resolve } from "node:path";

export const databaseProviders = ["pg", "sqlite"] as const;

export type DatabaseProvider = (typeof databaseProviders)[number];

export const defaultDatabaseUrl = (provider: DatabaseProvider): string =>
  provider === "sqlite"
    ? "file:./prisma-sqlite/dev.db"
    : "postgresql://yukino:yukino@localhost:5432/yukino_chat";

export const databaseUrlFor = (
  provider: DatabaseProvider,
  configuredUrl: string | undefined,
): string => {
  if (provider === "sqlite") {
    return configuredUrl?.startsWith("file:") ? configuredUrl : defaultDatabaseUrl(provider);
  }
  return configuredUrl && /^postgres(ql)?:\/\//.test(configuredUrl)
    ? configuredUrl
    : defaultDatabaseUrl(provider);
};

export const resolveDatabaseUrl = (provider: DatabaseProvider, url: string): string => {
  if (provider !== "sqlite" || !url.startsWith("file:")) return url;
  const filePath = url.slice("file:".length);
  return `file:${resolve(filePath)}`;
};
