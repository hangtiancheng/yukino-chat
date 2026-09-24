import { Config } from "@yukino.js/yukino";
import { env } from "../config/env.js";

// Resolves the embedded agent's provider stack. Primary source is yukino's own
// config (~/.yukino/config.yaml then ./.yukino/config.yaml, same as the Go
// bridge); when no config file exists a single provider can be synthesized
// from YUKINO_AI_* env vars. null means "agent unavailable" — chat keeps
// working and the assistant thread reports itself unavailable.
export interface AgentConfig {
  provider: Config.ProviderConfig;
  mcpServers: Config.MCPServerConfig[];
  hooks: Config.HookConfig[];
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
    const providers = (cfg as { providers?: Config.ProviderConfig[] }).providers ?? [];
    if (providers.length > 0) {
      const config = cfg as {
        providers: Config.ProviderConfig[];
        mcp_servers?: Config.MCPServerConfig[];
        hooks?: Config.HookConfig[];
        permission_mode?: string;
      };
      return {
        provider: config.providers[0] as Config.ProviderConfig,
        mcpServers: config.mcp_servers ?? [],
        hooks: config.hooks ?? [],
        permissionMode: config.permission_mode ?? "default",
      };
    }
  } catch {
    // Fall through to env.
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
    permissionMode: "default",
  };
}
