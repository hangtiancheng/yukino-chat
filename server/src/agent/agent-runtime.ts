import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  Agent,
  Compact,
  Config,
  MCP,
  Permissions,
  Remote,
  Skills,
  Subagent,
} from "@yukino.js/yukino";
import { env } from "../config/env.js";
import type { AgentStores } from "./agent-stores.js";
import { EventAdapter } from "./event-adapter.js";
import { InteractionBroker } from "./interaction-broker.js";
import {
  type PermissionRequestParams,
  type QuestionRequestParams,
  rpcNotification,
  SERVER_COMMANDS,
} from "./rpc-protocol.js";
import type { AgentConfig } from "./yukino-config.js";

export interface AgentConnection {
  id: string;
  send(msg: object): void;
  close(code?: number, reason?: string): void;
}

export interface ChatSink {
  saveAssistantText(userId: string, chatSessionId: string, text: string): Promise<string>;
}

export interface AgentRuntimeOptions {
  userId: string;
  workDir: string;
  config: AgentConfig;
  stores: AgentStores;
  sink: ChatSink;
}

interface PromptJob {
  chatSessionId: string;
  messageId: string;
  content: string;
}

type Handle = Remote.Server.RemoteAgentHandle;

// A long-lived, per-user agent runtime. One instance owns the Yukino agent
// stack (via createRemoteAgent), the DB session row used for rehydration, and
// the set of attached /agent/ws connections. Prompts are serialized through a
// single worker queue; each turn constructs a fresh Agent with the session's
// permission mode. Mirrors the Go bridge's per-user Session.
export class AgentRuntime {
  readonly userId: string;
  readonly workDir: string;

  private readonly config: AgentConfig;
  private readonly stores: AgentStores;
  private readonly sink: ChatSink;
  private readonly broker = new InteractionBroker();
  private readonly mcpAnnounced = new Set<string>();
  private readonly connections = new Set<AgentConnection>();

  private handlePromise: Promise<Handle> | null = null;
  private sessionId = "";
  private permissionMode: Permissions.PermissionMode = "default";

  private queue: PromptJob[] = [];
  private workerActive = false;
  private abortController: AbortController | null = null;
  private cancelRequested = false;
  private turnStartedAt = 0;

  private streaming = false;
  private anchorId = "";
  private lastUsage = { inputTokens: 0, outputTokens: 0 };
  private disposed = false;
  lastActivity = Date.now();

  constructor(options: AgentRuntimeOptions) {
    this.userId = options.userId;
    this.workDir = options.workDir;
    this.config = options.config;
    this.stores = options.stores;
    this.sink = options.sink;
    this.permissionMode = normalizeMode(options.config.permissionMode);
  }

  // DB session row + full agent stack, created once and reused.
  private ensureReady(): Promise<Handle> {
    if (this.handlePromise) return this.handlePromise;
    this.handlePromise = (async () => {
      const row = await this.stores.getOrCreateSession(this.userId, this.permissionMode);
      this.sessionId = row.id;
      await mkdir(this.workDir, { recursive: true });
      const handle = await Remote.Server.createRemoteAgent({
        provider: this.config.provider,
        workDir: this.workDir,
        mcpServers: this.config.mcpServers,
        hooks: this.config.hooks,
        enableCoordinatorMode: false,
        forkDisabled: false,
        askUser: (questions) => this.askUser(questions),
      });
      await this.rehydrate(handle);
      return handle;
    })();
    this.handlePromise.catch(() => {});
    return this.handlePromise;
  }

  // Restores the conversation from the DB context snapshot. Wrappers that are
  // re-derivable (<system-reminder> memory/MCP injections) are dropped so
  // they don't accumulate across restarts.
  private async rehydrate(handle: Handle) {
    handle.conv.reset();
    const { messages } = await this.stores.loadContext(this.sessionId);
    const restored = messages.filter((m) => !isWrappedSystemReminder(m));
    if (restored.length > 0) {
      handle.conv.appendMessages(restored);
    }
  }

  private async saveContext(handle: Handle) {
    await this.stores.saveContext(this.sessionId, handle.conv.getMessages(), [
      ...handle.activeSkills.keys(),
    ]);
  }

  // ---- connections ----

  get connectionCount(): number {
    return this.connections.size;
  }

  isBusy(): boolean {
    return this.streaming || this.workerActive || this.broker.hasPending();
  }

  async attach(conn: AgentConnection) {
    this.connections.add(conn);
    this.lastActivity = Date.now();
    try {
      await this.ensureReady();
    } catch (err) {
      conn.send(rpcNotification("agent/error", { message: describeError(err) }));
      return;
    }
    conn.send(rpcNotification("session/connected", this.connectedParams()));
    conn.send(rpcNotification("session/commands", { commands: SERVER_COMMANDS }));
    const snap = this.broker.snapshot();
    for (const p of snap.permissions) {
      conn.send(rpcNotification("permission/request", p as never));
    }
    for (const q of snap.questions) {
      conn.send(rpcNotification("question/ask", q as never));
    }
  }

  detach(conn: AgentConnection) {
    this.connections.delete(conn);
    this.lastActivity = Date.now();
  }

  private notifyAll(method: string, params?: Record<string, unknown>) {
    for (const conn of this.connections) {
      conn.send(rpcNotification(method, params));
    }
  }

  private connectedParams() {
    return {
      model: this.config.provider.model,
      streaming: this.streaming,
      ready: true,
      anchorId: this.anchorId,
      inputTokens: this.lastUsage.inputTokens,
      outputTokens: this.lastUsage.outputTokens,
      permissionMode: this.permissionMode,
    };
  }

  // ---- prompt queue ----

  // Enqueues a chat prompt; the queue cap mirrors the Go bridge (overflow
  // tells the user Yukino is still catching up).
  dispatch(job: PromptJob) {
    if (this.disposed) return;
    if (this.queue.length >= env.AGENT_QUEUE_CAP) {
      this.notifyAll("agent/system", {
        message:
          "Yukino is still working through earlier messages — please wait for it to catch up.",
      });
      return;
    }
    this.queue.push(job);
    this.lastActivity = Date.now();
    void this.runWorker();
  }

  private async runWorker() {
    if (this.workerActive) return;
    this.workerActive = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift() as PromptJob;
        if (this.disposed) break;
        try {
          await this.runTurn(job);
        } catch (err) {
          this.notifyAll("agent/error", { message: describeError(err) });
          this.streaming = false;
        }
        this.notifyAll("session/command_done");
        this.lastActivity = Date.now();
      }
    } finally {
      this.workerActive = false;
    }
  }

  // ---- turns ----

  private async runTurn(job: PromptJob) {
    let handle: Handle;
    try {
      handle = await this.ensureReady();
    } catch (err) {
      await this.sink.saveAssistantText(
        this.userId,
        job.chatSessionId,
        "I can't reply right now — Yukino is not configured on this server.",
      );
      this.notifyAll("agent/error", { message: describeError(err) });
      return;
    }

    if (job.content.startsWith("/")) {
      await this.handleCommand(handle, job);
      return;
    }

    this.streaming = true;
    this.cancelRequested = false;
    this.turnStartedAt = Date.now();
    this.notifyAll("agent/run_start", { userMessageId: job.messageId });
    this.anchorId = job.messageId;

    handle.conv.addUserMessage(job.content);
    if (handle.mcpManager) {
      MCP.Instructions.syncMcpInstructions(handle.conv, this.mcpAnnounced, handle.mcpManager);
    }

    const checker = new Permissions.PermissionChecker(this.workDir, this.permissionMode);
    const abort = new AbortController();
    this.abortController = abort;
    const adapter = new EventAdapter(() => (Date.now() - this.turnStartedAt) / 1000);

    const agent = new Agent.Agent({
      client: handle.client,
      registry: handle.registry,
      checker,
      conversation: handle.conv,
      workDir: this.workDir,
      // Session persistence is DB-only: an empty sessionId disables the
      // library's own JSONL session writes so the DB context stays
      // authoritative.
      sessionId: "",
      fileHistory: handle.fileHistory,
      fileStateCache: handle.fileStateCache,
      abortSignal: abort.signal,
      contextWindow: handle.contextWindow,
      maxOutput: Config.getMaxOutputTokens(handle.provider),
      recoveryState: handle.recoveryState,
      activeSkills: handle.activeSkills,
      instructions: handle.longTermMemoryInstructions,
      memoryContent: handle.longTermMemoryMemoryContent,
      skillSection: handle.skillCatalog
        ? Skills.Catalog.buildSkillSection(handle.skillCatalog, this.workDir)
        : "",
      notificationFn: () => [
        ...handle.teamManager.drainLeads(),
        ...handle.backgroundTaskManager
          .drainNotifications()
          .map(Subagent.TaskManager.formatAgentTaskNotification),
      ],
      onPermissionRequest: async (toolName, args) => {
        const description = checker.describeToolAction(toolName, args);
        const params: PermissionRequestParams = {
          id: `perm_${process.hrtime.bigint()}`,
          toolName,
          description,
        };
        this.notifyAll("permission/request", params as never);
        return this.broker.requestPermission(params);
      },
    });

    try {
      for await (const event of agent.run()) {
        for (const action of adapter.map(event)) {
          if (action.kind === "notify") {
            this.notifyAll(action.method, action.params);
          } else {
            await this.flushText(handle, job.chatSessionId, adapter);
          }
        }
      }
      if (!adapter.completed) {
        await this.flushText(handle, job.chatSessionId, adapter);
        if (adapter.cancelRequested) {
          this.notifyAll("agent/system", { message: "Stopped." });
        }
      }
    } finally {
      this.abortController = null;
      this.streaming = false;
      await this.saveContext(handle);
    }
  }

  // Files one finalized text block as an ordinary chat message and announces
  // its uuid so the client can anchor the bubble.
  private async flushText(_handle: Handle, chatSessionId: string, adapter: EventAdapter) {
    const text = adapter.takeStreamText();
    if (text === "") return;
    const messageId = await this.sink.saveAssistantText(this.userId, chatSessionId, text);
    if (messageId) this.anchorId = messageId;
    this.notifyAll("agent/stream_end", { text, messageId });
  }

  // ---- human-in-the-loop ----

  private async askUser(
    questions: QuestionRequestParams["questions"],
  ): Promise<Record<string, string>> {
    const params: QuestionRequestParams = {
      id: `ask_${process.hrtime.bigint()}`,
      questions,
    };
    this.notifyAll("question/ask", params as never);
    const answers = await this.broker.requestAnswers(params);
    return answers;
  }

  // ---- slash commands ----

  private async handleCommand(handle: Handle, job: PromptJob) {
    const [name, args] = splitCommand(job.content);
    switch (name) {
      case "/help": {
        const lines = SERVER_COMMANDS.map((c) => `/${c.name} — ${c.description}`);
        this.notifyAll("agent/system", { message: lines.join("\n") });
        return;
      }
      case "/clear": {
        handle.conv.reset();
        this.mcpAnnounced.clear();
        await this.saveContext(handle);
        this.notifyAll("session/context_cleared");
        return;
      }
      case "/compact": {
        const schemas = handle.registry.getAllSchemas(handle.client.protocol ?? "anthropic");
        const toolNames = handle.registry.listTools().map((t) => t.name);
        try {
          const result = await Compact.Compact.forceCompact(
            handle.conv,
            handle.client,
            handle.recoveryState,
            toolNames,
            schemas,
            undefined,
            undefined,
            args,
          );
          this.notifyAll("agent/compact", { message: result.message });
        } catch (err) {
          this.notifyAll("agent/error", { message: describeError(err) });
        }
        return;
      }
      case "/plan": {
        const entering = this.permissionMode !== "plan";
        this.permissionMode = entering ? "plan" : "default";
        this.notifyAll("agent/system", {
          message: entering
            ? "Plan mode enabled — Yukino will read and research without writing."
            : "Plan mode disabled — back to normal mode.",
        });
        return;
      }
      default:
        this.notifyAll("agent/error", {
          message: `Unknown command: ${name} — type /help to see available commands`,
        });
    }
  }

  // ---- control ----

  resolvePermission(id: string, decision: "allow" | "deny" | "allowAlways"): boolean {
    return this.broker.resolvePermission(id, decision);
  }

  resolveQuestion(id: string, answers: Record<string, string>): boolean {
    return this.broker.resolveQuestion(id, answers);
  }

  cancel() {
    this.cancelRequested = true;
    this.abortController?.abort();
    this.broker.cancelAll("run cancelled");
  }

  // Idempotent teardown used by idle eviction and shutdown.
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.queue = [];
    this.cancel();
    if (this.handlePromise) {
      const handle = await this.handlePromise.catch(() => null);
      if (handle) {
        await this.saveContext(handle);
        await handle.mcpManager?.disconnectAll().catch(() => {});
        await handle.backgroundTaskManager.stopAll().catch(() => {});
        await handle.teamManager.stopAll().catch(() => {});
      }
    }
    for (const conn of this.connections) {
      conn.close(1001, "runtime disposed");
    }
    this.connections.clear();
  }
}

// The chat sink files assistant replies as ordinary chat messages; the
// manager owns the DB/hub plumbing, the runtime just calls back.
export function makeWorkDir(root: string, userId: string): string {
  return path.join(root, ".yukino", "chat", userId);
}

function normalizeMode(mode: string): Permissions.PermissionMode {
  const known: Permissions.PermissionMode[] = [
    "default",
    "acceptEdits",
    "plan",
    "bypassPermissions",
  ];
  return known.includes(mode as Permissions.PermissionMode)
    ? (mode as Permissions.PermissionMode)
    : "default";
}

function splitCommand(content: string): [string, string] {
  const trimmed = content.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return [trimmed, ""];
  return [trimmed.slice(0, spaceIdx), trimmed.slice(spaceIdx + 1).trim()];
}

function isWrappedSystemReminder(message: ConversationMessage): boolean {
  const content = message.content;
  if (typeof content !== "string") return false;
  return content.startsWith("<system-reminder>") && content.includes("</system-reminder>");
}

interface ConversationMessage {
  role: string;
  content: unknown;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
