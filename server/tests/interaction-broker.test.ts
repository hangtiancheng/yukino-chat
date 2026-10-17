import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InteractionBroker } from "../src/agent/interaction-broker.js";

describe("interaction broker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves permissions with the caller's decision", async () => {
    const broker = new InteractionBroker();
    const promise = broker.requestPermission({ id: "perm_1", toolName: "Bash", description: "ls" });
    expect(broker.resolvePermission("perm_1", "allow")).toBe(true);
    await expect(promise).resolves.toBe("allow");
  });

  it("returns false for unknown permission ids", () => {
    const broker = new InteractionBroker();
    expect(broker.resolvePermission("missing", "allow")).toBe(false);
  });

  it("fails closed: permissions time out to deny", async () => {
    const broker = new InteractionBroker();
    const promise = broker.requestPermission({ id: "perm_2", toolName: "Bash", description: "rm" });
    const decision = Promise.race([
      promise,
      vi.advanceTimersByTimeAsync(5 * 60 * 1000).then(() => promise),
    ]);
    await expect(decision).resolves.toBe("deny");
  });

  it("fails closed: questions reject on timeout", async () => {
    const broker = new InteractionBroker();
    const promise = broker.requestAnswers({
      id: "ask_1",
      questions: [{ question: "q", header: "h", options: [], multiSelect: false }],
    });
    const attempt = vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await expect(promise).rejects.toThrow("question timed out");
    await attempt;
  });

  it("cancelAll denies pending permissions", async () => {
    const broker = new InteractionBroker();
    const promise = broker.requestPermission({ id: "perm_3", toolName: "Bash", description: "x" });
    broker.cancelAll("run cancelled");
    await expect(promise).resolves.toBe("deny");
    expect(broker.hasPending()).toBe(false);
  });

  it("settles a permission to deny when its abort signal fires", async () => {
    const broker = new InteractionBroker();
    const controller = new AbortController();
    const promise = broker.requestPermission(
      { id: "perm_abort", toolName: "Bash", description: "x" },
      controller.signal,
    );
    expect(broker.hasPending()).toBe(true);
    controller.abort();
    await expect(promise).resolves.toBe("deny");
    // The entry is gone, so a late client response is a no-op (returns false).
    expect(broker.hasPending()).toBe(false);
    expect(broker.resolvePermission("perm_abort", "allow")).toBe(false);
  });

  it("denies immediately when the signal is already aborted", async () => {
    const broker = new InteractionBroker();
    const controller = new AbortController();
    controller.abort();
    const promise = broker.requestPermission(
      { id: "perm_pre", toolName: "Bash", description: "x" },
      controller.signal,
    );
    await expect(promise).resolves.toBe("deny");
    expect(broker.hasPending()).toBe(false);
  });

  it("detaches the abort listener once resolved normally", async () => {
    const broker = new InteractionBroker();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const promise = broker.requestPermission(
      { id: "perm_off", toolName: "Bash", description: "x" },
      controller.signal,
    );
    expect(broker.resolvePermission("perm_off", "allow")).toBe(true);
    await expect(promise).resolves.toBe("allow");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    // Aborting afterwards must not flip the already-settled decision.
    controller.abort();
    expect(broker.hasPending()).toBe(false);
  });

  it("snapshots pending prompts for reconnect replay", async () => {
    const broker = new InteractionBroker();
    void broker.requestPermission({ id: "perm_4", toolName: "Bash", description: "x" });
    const answers = broker
      .requestAnswers({
        id: "ask_2",
        questions: [{ question: "q", header: "h", options: [], multiSelect: false }],
      })
      .catch(() => ({}));
    const snap = broker.snapshot();
    expect(snap.permissions.map((p) => p.id)).toEqual(["perm_4"]);
    expect(snap.questions.map((q) => q.id)).toEqual(["ask_2"]);
    broker.cancelAll();
    expect(broker.hasPending()).toBe(false);
    expect(await answers).toEqual({});
  });
});
