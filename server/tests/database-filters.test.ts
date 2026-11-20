import { afterEach, describe, expect, it, vi } from "vitest";

const loadFilter = async (provider: "pg" | "sqlite") => {
  vi.resetModules();
  process.env.DATABASE_PROVIDER = provider;
  process.env.DATABASE_URL =
    provider === "sqlite" ? "file:./prisma-sqlite/test.db" : "postgresql://u:p@localhost:5432/db";
  const { insensitiveContains } = await import("../src/database/filters.js");
  return insensitiveContains("abc");
};

describe("insensitiveContains", () => {
  afterEach(() => {
    delete process.env.DATABASE_PROVIDER;
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  it("omits the PostgreSQL-only mode for sqlite", async () => {
    await expect(loadFilter("sqlite")).resolves.toEqual({ contains: "abc" });
  });

  it("keeps insensitive mode for postgres", async () => {
    await expect(loadFilter("pg")).resolves.toEqual({ contains: "abc", mode: "insensitive" });
  });
});
