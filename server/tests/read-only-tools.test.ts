import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Tools } from "@yukino.js/yukino";
import { afterEach, describe, expect, it } from "vitest";

import {
  containedPath,
  containReadTools,
  createReadOnlyToolFilter,
  FORK_DISALLOWED_TOOLS,
  isPathContained,
  patternEscapes,
} from "../src/agent/read-only-tools.js";

type Tool = Tools.Types.Tool;
type ToolResult = Tools.Types.ToolResult;

function fakeTool(name: string, result: ToolResult): Tool & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    name,
    description: `fake ${name}`,
    category: "read",
    calls,
    schema: () => ({
      name,
      description: `fake ${name}`,
      input_schema: { type: "object" as const, properties: {} },
    }),
    execute: async (_ctx, args) => {
      calls.push(args);
      return result;
    },
  };
}

const roots: string[] = [];
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "yukino-chat-ws-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("read-only tool filter", () => {
  it("allows read, interaction and task-board tools plus MCP tools", () => {
    const filter = createReadOnlyToolFilter();
    for (const name of [
      "ReadFile",
      "Glob",
      "Grep",
      "WebFetch",
      "ToolSearch",
      "McpCall",
      "LoadSkill",
      "AskUserQuestion",
      "TaskCreate",
      "TodoWrite",
      "Goal",
      "mcp__server__tool",
    ]) {
      expect(filter(name), name).toBe(true);
    }
  });

  it("denies every write, command and delegation tool", () => {
    const filter = createReadOnlyToolFilter();
    for (const name of [
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
      "LSP",
    ]) {
      expect(filter(name), name).toBe(false);
    }
  });

  it("strips write and delegation tools from fork subagents", () => {
    expect(FORK_DISALLOWED_TOOLS).toContain("Bash");
    expect(FORK_DISALLOWED_TOOLS).toContain("WriteFile");
    expect(FORK_DISALLOWED_TOOLS).toContain("Agent");
    expect(FORK_DISALLOWED_TOOLS).not.toContain("ReadFile");
  });
});

describe("path containment", () => {
  it("allows paths inside the workspace", () => {
    const root = makeRoot();
    writeFileSync(join(root, "a.txt"), "a");
    expect(containedPath(root, "a.txt")).toBe(join(root, "a.txt"));
    expect(containedPath(root, ".")).not.toBeNull();
    expect(containedPath(root, "./nested/deep/b.txt")).not.toBeNull();
  });

  it("denies traversal, absolute paths and home expansion", () => {
    const root = makeRoot();
    expect(containedPath(root, "../escape.txt")).toBeNull();
    expect(containedPath(root, "nested/../../escape.txt")).toBeNull();
    expect(containedPath(root, "/etc/passwd")).toBeNull();
    expect(containedPath(root, "~/.yukino/config.yaml")).toBeNull();
    expect(containedPath(root, "~")).toBeNull();
  });

  it("denies another user's workspace", () => {
    const base = makeRoot();
    const userA = join(base, "user-a");
    const userB = join(base, "user-b");
    expect(containedPath(userA, userB)).toBeNull();
    expect(isPathContained(userA, join(userB, "secret.txt"))).toBe(false);
    expect(isPathContained(userA, join(userA, "ok.txt"))).toBe(true);
  });

  it("denies symlinks that resolve outside the workspace", () => {
    const root = makeRoot();
    const outside = makeRoot();
    writeFileSync(join(outside, "secret.txt"), "s");
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));
    symlinkSync(outside, join(root, "dir-link"));
    expect(containedPath(root, "link.txt")).toBeNull();
    expect(containedPath(root, "dir-link/secret.txt")).toBeNull();
  });

  it("flags escaping glob patterns", () => {
    expect(patternEscapes("../**/*.ts")).toBe(true);
    expect(patternEscapes("src/../../etc/*")).toBe(true);
    expect(patternEscapes("/etc/*")).toBe(true);
    expect(patternEscapes("**/*.ts")).toBe(false);
    expect(patternEscapes("src/**/*.test.ts")).toBe(false);
  });
});

describe("containReadTools", () => {
  function makeRegistry(root: string) {
    const registry = new Tools.Registry.ToolRegistry();
    const readFile = fakeTool("ReadFile", { output: "file body", isError: false });
    const glob = fakeTool("Glob", { output: "matches", isError: false });
    const grep = fakeTool("Grep", { output: "hits", isError: false });
    const webFetch = fakeTool("WebFetch", { output: "page", isError: false });
    const bash = fakeTool("Bash", { output: "nope", isError: false });
    for (const tool of [readFile, glob, grep, webFetch, bash]) {
      registry.register(tool);
    }
    containReadTools(registry, root);
    return { registry, readFile, glob, grep, webFetch, bash };
  }

  const ctx = (cwd: string) => ({ cwd }) as never;

  it("passes through reads inside the workspace", async () => {
    const root = makeRoot();
    const { registry, readFile, glob, grep } = makeRegistry(root);
    const read = registry.get("ReadFile");
    const result = await read?.execute(ctx(root), { file_path: "notes.md" });
    expect(result).toEqual({ output: "file body", isError: false });
    expect(readFile.calls).toEqual([{ file_path: "notes.md" }]);

    const globResult = await registry.get("Glob")?.execute(ctx(root), { pattern: "**/*.ts" });
    expect(globResult?.isError).toBeFalsy();
    expect(glob.calls).toHaveLength(1);

    // Grep without an explicit path defaults to cwd inside the tool.
    await registry.get("Grep")?.execute(ctx(root), { pattern: "todo" });
    expect(grep.calls).toEqual([{ pattern: "todo" }]);
  });

  it("blocks reads outside the workspace without touching the inner tool", async () => {
    const root = makeRoot();
    const { registry, readFile, glob } = makeRegistry(root);
    const denied = await registry
      .get("ReadFile")
      ?.execute(ctx(root), { file_path: "../../etc/passwd" });
    expect(denied?.isError).toBe(true);
    expect(denied?.output).toContain("outside this user's workspace");
    expect(readFile.calls).toHaveLength(0);

    const deniedGlob = await registry
      .get("Glob")
      ?.execute(ctx(root), { pattern: "**/*.ts", path: "/etc" });
    expect(deniedGlob?.isError).toBe(true);
    expect(glob.calls).toHaveLength(0);

    const deniedPattern = await registry.get("Glob")?.execute(ctx(root), { pattern: "../**/*" });
    expect(deniedPattern?.isError).toBe(true);
    expect(glob.calls).toHaveLength(0);
  });

  it("keeps non-wrapped tools untouched", async () => {
    const root = makeRoot();
    const { registry, bash } = makeRegistry(root);
    await registry.get("Bash")?.execute(ctx(root), { command: "ls" });
    expect(bash.calls).toHaveLength(1);
  });

  it("blocks WebFetch to private and loopback addresses", async () => {
    const root = makeRoot();
    const { registry, webFetch } = makeRegistry(root);
    for (const url of [
      "http://127.0.0.1:8080/admin",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.1.2.3/internal",
      "http://192.168.1.1/",
      "http://[::1]/",
    ]) {
      const result = await registry.get("WebFetch")?.execute(ctx(root), { url });
      expect(result?.isError, url).toBe(true);
      expect(result?.output, url).toContain("cannot fetch");
    }
    expect(webFetch.calls).toHaveLength(0);
  });

  it("allows WebFetch to public addresses", async () => {
    const root = makeRoot();
    const { registry, webFetch } = makeRegistry(root);
    // IP literal — assertPublicHttpUrl does not hit the network for literals.
    const result = await registry
      .get("WebFetch")
      ?.execute(ctx(root), { url: "http://93.184.216.34/" });
    expect(result).toEqual({ output: "page", isError: false });
    expect(webFetch.calls).toHaveLength(1);
  });
});
