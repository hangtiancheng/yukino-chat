import { describe, expect, it } from "vitest";
import { EventAdapter } from "../src/agent/event-adapter.js";

describe("event adapter", () => {
  it("accumulates stream text and flushes on tool use", () => {
    const adapter = new EventAdapter(() => 1);
    const actions1 = adapter.map({ type: "stream_text", text: "Hello " } as never);
    expect(actions1).toEqual([
      { kind: "notify", method: "agent/stream_text", params: { text: "Hello " } },
    ]);
    adapter.map({ type: "stream_text", text: "world" } as never);

    const actions2 = adapter.map({
      type: "tool_use",
      toolName: "Bash",
      toolId: "t1",
      args: {},
    } as never);
    expect(actions2[0]).toEqual({ kind: "flush" });
    expect(adapter.takeStreamText()).toBe("Hello world");
  });

  it("counts turns and reports completion", () => {
    const adapter = new EventAdapter(() => 2.5);
    adapter.map({ type: "turn_complete" } as never);
    const actions = adapter.map({ type: "loop_complete", stopReason: "end_turn" } as never);
    expect(adapter.completed).toBe(true);
    const loop = actions.find((a) => a.kind === "notify");
    expect(loop).toEqual({
      kind: "notify",
      method: "agent/loop_complete",
      params: { totalTurns: 1, elapsed: 2.5, stopReason: "end_turn" },
    });
  });

  it("swallows errors after cancellation", () => {
    const adapter = new EventAdapter(() => 0);
    adapter.cancelRequested = true;
    const actions = adapter.map({ type: "error", error: new Error("aborted") } as never);
    expect(actions).toEqual([]);
  });

  it("ignores in-band permission requests", () => {
    const adapter = new EventAdapter(() => 0);
    const actions = adapter.map({
      type: "permission_request",
      toolName: "Bash",
      args: {},
    } as never);
    expect(actions).toEqual([]);
  });
});
