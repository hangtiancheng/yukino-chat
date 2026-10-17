/**
 * Read-only tool policy for the chat-embedded Yukino agent.
 *
 * Multi-user isolation model — every user gets one AgentRuntime with a private
 * workspace (.yukino/chat/<uid>), and this module makes sure the agent cannot
 * reach outside it:
 *
 * - READ_ONLY_TOOLS gates which tools the model sees and may execute (the
 *   Agent applies the filter to both the advertised schemas and every call).
 *   Write/command tools (Bash, EditFile, WriteFile, worktree, teams, subagent
 *   spawning, plan-mode control) are excluded entirely.
 * - containReadTools() wraps the path-based read tools so ReadFile/Glob/Grep
 *   only resolve paths inside the user's own workspace. Yukino's permission
 *   layer path-sandboxes writes only, so without this a ReadFile call could
 *   reach another user's workspace or host files (~/.yukino/config.yaml).
 * - WebFetch is guarded by yukino's own public-URL assertion (blocks loopback,
 *   private, link-local and reserved ranges, including DNS-resolved ones).
 * - FORK_DISALLOWED_TOOLS strips the same write/command tools from fork-mode
 *   skill subagents, so delegation is not a write escape hatch. Subagents
 *   reuse the wrapped registry, inheriting the path containment.
 */
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { type Tools, Utils } from "@yukino.js/yukino";

type Tool = Tools.Types.Tool;
type ToolResult = Tools.Types.ToolResult;
type ToolRegistry = Tools.Registry.ToolRegistry;

/**
 * Tools the chat agent may use: read-category tools plus the per-session
 * internal state tools (task board, goal) and interaction tools. MCP tools
 * (mcp__*) pass the filter too — their invocations stay gated by the
 * permission broker because MCPToolWrapper reports category "command".
 */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "ReadFile",
  "Glob",
  "Grep",
  "WebFetch",
  "ToolSearch",
  "McpCall",
  "LoadSkill",
  "AskUserQuestion",
  "SyntheticOutput",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
  "TodoWrite",
  "TaskOutput",
  "Goal",
]);

const MCP_TOOL_PREFIX = "mcp__";

export function createReadOnlyToolFilter(): (name: string) => boolean {
  return (name) => READ_ONLY_TOOLS.has(name) || name.startsWith(MCP_TOOL_PREFIX);
}

/** Write/command tools stripped from fork-mode skill subagent definitions. */
export const FORK_DISALLOWED_TOOLS: readonly string[] = [
  "Bash",
  "PowerShell",
  "ComputerUse",
  "EditFile",
  "WriteFile",
  "EnterPlanMode",
  "ExitPlanMode",
  "EnterWorktree",
  "ExitWorktree",
  "Agent",
  "TeamCreate",
  "TeamDelete",
  "SendMessage",
  "TaskStop",
];

/* ------------------------------ path containment ------------------------------ */

/** Mirrors yukino's resolveToolPath "~" expansion. */
function expandHome(raw: string): string {
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) return join(homedir(), raw.slice(2));
  return raw;
}

/** Resolves symlinks through the deepest existing ancestor (yukino canonicalPath semantics). */
export function canonicalize(target: string): string {
  let current = resolve(target);
  const missing: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(current), ...missing);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(target);
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

/** True when the (symlink-resolved) target stays inside the (resolved) root. */
export function isPathContained(root: string, target: string): boolean {
  const rel = relative(canonicalize(root), canonicalize(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Resolves raw against root (with "~" expansion); null when it escapes root. */
export function containedPath(root: string, raw: string): string | null {
  const absolute = resolve(root, expandHome(raw));
  return isPathContained(root, absolute) ? absolute : null;
}

const PARENT_SEGMENT = /(?:^|[/\\])\.\.(?:[/\\]|$)/u;

/** True for ".." path segments or absolute paths inside glob patterns. */
export function patternEscapes(pattern: string): boolean {
  return PARENT_SEGMENT.test(pattern) || isAbsolute(pattern);
}

/* --------------------------------- tool wrapping --------------------------------- */

type Guard = (args: Record<string, unknown>) => Promise<ToolResult | null> | ToolResult | null;

function guarded(tool: Tool, guard: Guard): Tool {
  const wrapped: Tool = {
    name: tool.name,
    description: tool.description,
    category: tool.category,
    schema: () => tool.schema(),
    execute: async (ctx, args) => (await guard(args)) ?? tool.execute(ctx, args),
  };
  if (tool.deferred !== undefined) wrapped.deferred = tool.deferred;
  if (tool.isConcurrencySafe) {
    wrapped.isConcurrencySafe = (args) => tool.isConcurrencySafe?.(args) ?? false;
  }
  if (tool.dispose) {
    wrapped.dispose = async () => {
      await tool.dispose?.();
    };
  }
  return wrapped;
}

/** Path arguments that must stay inside the workspace, per tool. */
const PATH_ARGS: Record<string, readonly string[]> = {
  ReadFile: ["file_path"],
  Glob: ["path"],
  Grep: ["path"],
};

/** Glob-style pattern arguments that must not traverse upward or go absolute. */
const PATTERN_ARGS: Record<string, readonly string[]> = {
  Glob: ["pattern"],
};

function denyOutsideWorkspace(toolName: string, value: string): ToolResult {
  return {
    output:
      `Error: ${toolName} denied — "${value}" is outside this user's workspace. ` +
      "The chat agent can only read files inside its own workspace.",
    isError: true,
  };
}

/**
 * Re-registers ReadFile/Glob/Grep/WebFetch with multi-user containment guards.
 * Instances are replaced in place, so subagent registries that borrow from
 * this one inherit the wrapped tools.
 */
export function containReadTools(registry: ToolRegistry, root: string): void {
  for (const [name, pathArgs] of Object.entries(PATH_ARGS)) {
    const tool = registry.get(name);
    if (!tool) continue;
    const patternArgs = PATTERN_ARGS[name] ?? [];
    registry.unregister(name);
    registry.register(
      guarded(tool, (args) => {
        for (const key of pathArgs) {
          const raw = args[key];
          if (typeof raw !== "string" || raw === "") continue;
          if (containedPath(root, raw) === null) return denyOutsideWorkspace(name, raw);
        }
        for (const key of patternArgs) {
          const raw = args[key];
          if (typeof raw === "string" && patternEscapes(raw)) {
            return denyOutsideWorkspace(name, raw);
          }
        }
        return null;
      }),
    );
  }

  const webFetch = registry.get("WebFetch");
  if (webFetch) {
    registry.unregister("WebFetch");
    registry.register(
      guarded(webFetch, async (args) => {
        const url = args.url;
        if (typeof url !== "string" || url === "") return null;
        try {
          await Utils.PublicHttp.assertPublicHttpUrl(url);
          return null;
        } catch (err) {
          return {
            output: `Error: cannot fetch ${url} — ${Utils.asErrorString(err)}`,
            isError: true,
          };
        }
      }),
    );
  }
}
