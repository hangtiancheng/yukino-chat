import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";
import { PrismaClient } from "../generated/prisma/client.js";

export const createPrismaClient = (databaseUrl = env.DATABASE_URL) => {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
};

export type PrismaDB = ReturnType<typeof createPrismaClient>;
