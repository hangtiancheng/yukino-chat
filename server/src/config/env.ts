import "dotenv/config";
import { z } from "zod";
import { databaseProviders, databaseUrlFor } from "./database.js";

const envSchema = z
  .object({
    PORT: z.coerce.number().default(8000),
    HOST: z.string().default("0.0.0.0"),
    DATABASE_PROVIDER: z.enum(databaseProviders).default("pg"),
    DATABASE_URL: z.string().min(1).optional(),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    JWT_SECRET: z.string().default("yukino-chat-jwt-secret"),
    TOKEN_EXPIRE_HOURS: z.coerce.number().default(336),
    CACHE_TTL_SECONDS: z.coerce.number().default(300),
    STATIC_AVATAR_DIR: z.string().default("./static/avatars"),
    STATIC_FILE_DIR: z.string().default("./static/files"),
    STATIC_CHUNK_DIR: z.string().default("./static/chunks"),
    WEB_DIST_DIR: z.string().default("./web"),
    AGENT_WS_MAX_MESSAGE_BYTES: z.coerce.number().default(4 * 1024 * 1024),
    AGENT_IDLE_MS: z.coerce.number().default(30 * 60 * 1000),
    AGENT_QUEUE_CAP: z.coerce.number().default(8),
    AGENT_INTERACTION_TIMEOUT_MS: z.coerce.number().default(5 * 60 * 1000),
    YUKINO_AI_PROTOCOL: z.enum(["", "anthropic", "openai", "openai-compat"]).default(""),
    YUKINO_AI_BASE_URL: z.string().default(""),
    YUKINO_AI_API_KEY: z.string().default(""),
    YUKINO_AI_MODEL: z.string().default(""),
  })
  .transform((value) => ({
    ...value,
    DATABASE_URL: databaseUrlFor(value.DATABASE_PROVIDER, value.DATABASE_URL),
  }))
  .refine(
    (value) =>
      value.DATABASE_PROVIDER === "sqlite"
        ? value.DATABASE_URL.startsWith("file:")
        : /^postgres(ql)?:\/\//.test(value.DATABASE_URL),
    { message: "DATABASE_URL must match DATABASE_PROVIDER", path: ["DATABASE_URL"] },
  );

export const env = envSchema.parse(process.env);
