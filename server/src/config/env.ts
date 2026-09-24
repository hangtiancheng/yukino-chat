import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(8000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.url().default("postgresql://root:pass@localhost:5432/yukino_chat"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_SECRET: z.string().default("yukino-chat-jwt-secret"),
  TOKEN_EXPIRE_HOURS: z.coerce.number().default(336),
  CACHE_TTL_SECONDS: z.coerce.number().default(300),
  STATIC_AVATAR_DIR: z.string().default("./static/avatars"),
  STATIC_FILE_DIR: z.string().default("./static/files"),
  STATIC_CHUNK_DIR: z.string().default("./static/chunks"),
  AGENT_WS_MAX_MESSAGE_BYTES: z.coerce.number().default(4 * 1024 * 1024),
  AGENT_IDLE_MS: z.coerce.number().default(30 * 60 * 1000),
  AGENT_QUEUE_CAP: z.coerce.number().default(8),
  AGENT_INTERACTION_TIMEOUT_MS: z.coerce.number().default(5 * 60 * 1000),
  // Env fallback for the embedded agent when ~/.yukino/config.yaml is absent.
  YUKINO_AI_PROTOCOL: z.enum(["", "anthropic", "openai", "openai-compat"]).default(""),
  YUKINO_AI_BASE_URL: z.string().default(""),
  YUKINO_AI_API_KEY: z.string().default(""),
  YUKINO_AI_MODEL: z.string().default(""),
});

export const env = envSchema.parse(process.env);
