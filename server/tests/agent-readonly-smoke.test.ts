import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Remote } from "@yukino.js/yukino";
import { describe, expect, it } from "vitest";

import { containReadTools, createReadOnlyToolFilter } from "../src/agent/read-only-tools.js";

/**
 * Assembly smoke: runs the real createRemoteAgent (no LLM calls — the client
 * is only constructed), applies the chat read-only policy, and verifies the
 * visible toolset, the workspace containment of the wrapped ReadFile, and the
 * command registry the chat dispatch relies on.
 */
describe("read-only agent assembly", () => {
  it("narrows the real registry to contained read-only tools", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "yukino-chat-agent-"));
    const siblingDir = mkdtempSync(join(tmpdir(), "yukino-chat-other-"));
    writeFileSync(join(workDir, "hello.txt"), "hi there");
    writeFileSync(join(siblingDir, "secret.txt"), "private");

    const handle = await Remote.Server.createRemoteAgent({
      provider: {
        name: "test",
        protocol: "openai-compat",
        base_url: "http://127.0.0.1:9/v1",
        model: "test-model",
        api_key: "test-key",
      },
      cwd: workDir,
      enableCoordinatorMode: false,
      forkDisabled: false,
      memoryEnabled: false,
    });

    try {
      handle.toolFilter = createReadOnlyToolFilter();
      containReadTools(handle.registry, workDir);

      const visible = handle.registry.listVisibleToolNames(
        "openai-compat",
        handle.toolFilter ?? undefined,
      );
      for (const name of ["ReadFile", "Glob", "Grep", "WebFetch", "LoadSkill"]) {
        expect(visible, name).toContain(name);
      }
      for (const name of [
        "Bash",
        "PowerShell",
        "ComputerUse",
        "EditFile",
        "WriteFile",
        "Agent",
        "TeamCreate",
        "EnterWorktree",
      ]) {
        expect(visible, name).not.toContain(name);
      }

      const readFile = handle.registry.get("ReadFile");
      const ctx = { cwd: workDir } as never;
      const allowed = await readFile?.execute(ctx, { file_path: "hello.txt" });
      expect(allowed?.isError).toBeFalsy();
      expect(String(allowed?.output)).toContain("hi there");

      const denied = await readFile?.execute(ctx, { file_path: join(siblingDir, "secret.txt") });
      expect(denied?.isError).toBe(true);
      expect(String(denied?.output)).toContain("outside this user's workspace");

      // The chat dispatch allowlist relies on these being registered.
      for (const name of ["help", "status", "clear", "compact", "skills", "goal"]) {
        expect(handle.cmdRegistry.find(name), name).toBeDefined();
      }
      // Registry-only commands that the chat host must NOT serve.
      expect(handle.cmdRegistry.find("quit")).toBeDefined();
    } finally {
      await handle.registry.dispose();
      await handle.backgroundTaskManager.stopAll().catch(() => {});
      await handle.teamManager.stopAll().catch(() => {});
      rmSync(workDir, { recursive: true, force: true });
      rmSync(siblingDir, { recursive: true, force: true });
    }
  }, 30_000);
});
