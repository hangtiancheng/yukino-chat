import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { type AgentConnection, AgentRuntime, makeWorkDir } from "../src/agent/agent-runtime.js";

/**
 * Connection-lifecycle unit tests. These exercise the multi-user reclamation
 * path directly (no LLM, no createRemoteAgent): a runtime must drop half-open
 * sockets so connectionCount returns to zero and idle eviction can reclaim the
 * per-user handle. Private state is reached through a narrow cast.
 */
function makeRuntime(): AgentRuntime {
  return new AgentRuntime({
    userId: "Utestuser01",
    workDir: path.join(tmpdir(), "yukino-chat-runtime-test"),
    config: {
      provider: {
        name: "test",
        protocol: "openai-compat",
        base_url: "http://127.0.0.1:9/v1",
        model: "test-model",
        api_key: "test-key",
      },
      mcpServers: [],
      hooks: [],
      permissionMode: "default",
    },
    stores: {} as never,
    sink: { saveAssistantText: async () => "" },
  });
}

interface FakeConn {
  conn: AgentConnection;
  calls: { ping: number; terminate: number; close: number; sent: object[] };
}

function fakeConn(id: string, lastSeen: number): FakeConn {
  const calls = { ping: 0, terminate: 0, close: 0, sent: [] as object[] };
  const conn: AgentConnection = {
    id,
    lastSeen,
    send: (msg) => {
      calls.sent.push(msg);
    },
    close: () => {
      calls.close += 1;
    },
    ping: () => {
      calls.ping += 1;
    },
    terminate: () => {
      calls.terminate += 1;
    },
  };
  return { conn, calls };
}

function connections(runtime: AgentRuntime): Set<AgentConnection> {
  return (runtime as unknown as { connections: Set<AgentConnection> }).connections;
}

describe("AgentRuntime connection sweep", () => {
  it("pings live connections and keeps them", () => {
    const runtime = makeRuntime();
    const now = Date.now();
    const { conn, calls } = fakeConn("live", now);
    connections(runtime).add(conn);

    runtime.sweepConnections(now);

    expect(calls.ping).toBe(1);
    expect(calls.terminate).toBe(0);
    expect(runtime.connectionCount).toBe(1);
  });

  it("terminates and removes half-open connections", () => {
    const runtime = makeRuntime();
    const now = Date.now();
    const stale = fakeConn("stale", now - 76_000);
    const fresh = fakeConn("fresh", now);
    connections(runtime).add(stale.conn);
    connections(runtime).add(fresh.conn);

    runtime.sweepConnections(now);

    expect(stale.calls.terminate).toBe(1);
    expect(stale.calls.ping).toBe(0);
    expect(fresh.calls.ping).toBe(1);
    expect(fresh.calls.terminate).toBe(0);
    // connectionCount drops so idle eviction can reclaim the runtime.
    expect(runtime.connectionCount).toBe(1);
    expect(connections(runtime).has(stale.conn)).toBe(false);
  });

  it("detach releases the connection slot", () => {
    const runtime = makeRuntime();
    const { conn } = fakeConn("c1", Date.now());
    connections(runtime).add(conn);
    expect(runtime.connectionCount).toBe(1);

    runtime.detach(conn);

    expect(runtime.connectionCount).toBe(0);
  });
});

describe("makeWorkDir", () => {
  it("builds a per-user workspace under the chat root", () => {
    expect(makeWorkDir("/root", "Uabc123")).toBe(path.join("/root", ".yukino", "chat", "Uabc123"));
  });

  it("strips traversal so a crafted userId cannot escape its workspace", () => {
    for (const evil of ["../../etc", "..", "U/evil", "a\\b", "U/../Uother"]) {
      const dir = makeWorkDir("/root", evil);
      expect(dir, evil).not.toContain("..");
      expect(dir.startsWith(path.join("/root", ".yukino", "chat")), evil).toBe(true);
      // The segment is reduced to safe characters only.
      expect(path.basename(dir), evil).toMatch(/^[A-Za-z0-9_-]+$/u);
    }
  });

  it("falls back to a stable name for an empty userId", () => {
    expect(makeWorkDir("/root", "")).toBe(path.join("/root", ".yukino", "chat", "anonymous"));
  });

  it("keeps distinct users in distinct workspaces", () => {
    expect(makeWorkDir("/root", "Ualice")).not.toBe(makeWorkDir("/root", "Ubob"));
  });
});
