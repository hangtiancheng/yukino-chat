import { defineConfig } from "vitest/config";

// Unit tests run without Redis or Postgres: the cache service falls back to an
// in-memory store when REDIS_URL is unset, and DB-touching code is not tested.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    env: {
      NODE_ENV: "test",
      REDIS_URL: "",
    },
  },
});
