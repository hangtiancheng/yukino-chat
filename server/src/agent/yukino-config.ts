import { Config, type LSP } from "@yukino.js/yukino";
import { env } from "../config/env.js";

export interface AgentConfig {
  provider: Config.ProviderConfig.ProviderConfig;
  mcpServers: Config.MCPServerConfig[];
  hooks: Config.HookConfig[];
  /** Read-only code intelligence servers from config `lsp_servers`. */
  lspServers: LSP.Config.LspServerConfig[];
  /** Auto-memory switch from config `enable_memory` (defaults to enabled). */
  memoryEnabled: boolean;
  permissionMode: string;
}

let cached: AgentConfig | null | undefined;

export function loadAgentConfig(): AgentConfig | null {
  if (cached !== undefined) return cached;
  cached = resolve();
  return cached;
}

function resolve(): AgentConfig | null {
  try {
    const cfg = Config.loadConfig("", { allowEmptyProviders: true });
    if (cfg.providers.length > 0) {
      return {
        // Honor `default_provider` (clamped, falls back to the first entry).
        provider: Config.ProviderConfig.resolveDefaultProvider(cfg.providers, cfg.default_provider),
        mcpServers: cfg.mcp_servers,
        hooks: cfg.hooks,
        lspServers: cfg.lsp_servers ?? [],
        memoryEnabled: Config.memoryEnabled(cfg),
        permissionMode: cfg.permission_mode ?? "default",
      };
    }
  } catch {
    // No readable config.yaml — fall through to the env-based provider below.
  }
  if (env.YUKINO_AI_BASE_URL === "" || env.YUKINO_AI_MODEL === "") {
    return null;
  }
  return {
    provider: {
      name: "yukino",
      protocol: env.YUKINO_AI_PROTOCOL === "" ? "openai-compat" : env.YUKINO_AI_PROTOCOL,
      base_url: env.YUKINO_AI_BASE_URL,
      model: env.YUKINO_AI_MODEL,
      ...(env.YUKINO_AI_API_KEY ? { api_key: env.YUKINO_AI_API_KEY } : {}),
    },
    mcpServers: [],
    hooks: [],
    lspServers: [],
    memoryEnabled: true,
    permissionMode: "default",
  };
}
