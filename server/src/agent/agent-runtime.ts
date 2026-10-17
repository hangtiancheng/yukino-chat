import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  Bootstrap,
  Commands,
  Compact,
  Permissions,
  Remote,
  Session,
  Skills,
  Subagent,
  Utils,
} from "@yukino.js/yukino";
import { env } from "../config/env.js";
import type { AgentStores } from "./agent-stores.js";
import { EventAdapter } from "./event-adapter.js";
import { InteractionBroker } from "./interaction-broker.js";
import {
  containReadTools,
  createReadOnlyToolFilter,
  FORK_DISALLOWED_TOOLS,
} from "./read-only-tools.js";
import {
  type PermissionRequestParams,
  type QuestionRequestParams,
  rpcNotification,
} from "./rpc-protocol.js";
import type { AgentConfig } from "./yukino-config.js";

export interface AgentConnection {
  id: string;
  send(msg: object): void;
  close(code?: number, reason?: string): void;
  /** Protocol-level liveness probe (ws.ping); browsers answer with a pong. */
  ping(): void;
  /** Hard-drop a socket the heartbeat sweep flagged as half-open. */
  terminate(): void;
  /** Updated by the route on every pong/inbound frame; drives the stale sweep. */
  lastSeen: number;
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

/**
 * No-pong threshold for the connection heartbeat: a socket that has not been
 * seen for this long is treated as half-open and terminated. Mirrors the
 * remote server's heartbeat sweep — a browser tab killed without a close
 * frame must not pin a per-user runtime (and its connection slot) forever.
 */
const HEARTBEAT_STALE_MS = 75_000;

/** Built-in "local" commands that make sense in a multi-user chat. */
const CHAT_LOCAL_COMMANDS: ReadonlySet<string> = new Set(["help", "status"]);
/** Built-in "local_ui" commands implemented by this runtime. */
const CHAT_LOCAL_UI_COMMANDS: ReadonlySet<string> = new Set(["clear", "compact", "skills"]);

export class AgentRuntime {
  readonly userId: string;
  readonly workDir: string;

  private readonly config: AgentConfig;
  private readonly stores: AgentStores;
  private readonly sink: ChatSink;
  private readonly broker = new InteractionBroker();
  private readonly connections = new Set<AgentConnection>();
  private readonly describer: Permissions.PermissionChecker;
  /**
   * Structured JSONL log of degraded agent events (failed tool results,
   * retries, compaction, agent errors), keyed by user. Routine progress is
   * dropped. In a multi-user host an operator cannot watch every client, so
   * these are the server-side signals that a provider/MCP/tool is unhealthy.
   */
  private readonly eventLogger: Remote.Log.AgentEventLogger;

  private handlePromise: Promise<Handle> | null = null;
  private handle: Handle | null = null;
  private sessionId = "";
  private readonly permissionMode: Permissions.PermissionMode;

  private queue: PromptJob[] = [];
  private workerActive = false;
  private activeAdapter: EventAdapter | null = null;
  private forkController: AbortController | null = null;
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
    this.describer = new Permissions.PermissionChecker(this.workDir, this.permissionMode);
    this.eventLogger = new Remote.Log.AgentEventLogger(consoleEventLogger(this.userId));
  }

  private ensureReady(): Promise<Handle> {
    if (this.handlePromise) return this.handlePromise;
    this.handlePromise = (async () => {
      const row = await this.stores.getOrCreateSession(this.userId, this.permissionMode);
      this.sessionId = row.id;
      await mkdir(this.workDir, { recursive: true });
      const handle = await Remote.Server.createRemoteAgent({
        provider: this.config.provider,
        cwd: this.workDir,
        mcpServers: this.config.mcpServers,
        hooks: this.config.hooks,
        enableCoordinatorMode: false,
        forkDisabled: false,
        askUser: (questions) => this.askUser(questions),
      });
      this.handle = handle;
      handle.permissionMode = this.permissionMode;
      this.applyReadOnlyPolicy(handle);
      await this.rehydrate(handle);
      return handle;
    })();
    const initPromise = this.handlePromise;
    // Do not cache a failed init: a transient provider/MCP error must not
    // permanently brick this user's runtime. Reset so the next attach/dispatch
    // retries (mirrors RemoteServer.ensureAgent, which clears its init promise
    // in a finally). The catch also keeps the rejection from going unhandled.
    void initPromise.catch(() => {
      if (this.handlePromise === initPromise) {
        this.handlePromise = null;
        this.handle = null;
      }
    });
    return this.handlePromise;
  }

  /**
   * Multi-user hardening applied once per handle: narrow the toolset to
   * read-only tools, contain path reads to this user's workspace, and route
   * fork-mode skills through a read-only subagent definition (see
   * read-only-tools.ts for the isolation model).
   */
  private applyReadOnlyPolicy(handle: Handle): void {
    handle.toolFilter = createReadOnlyToolFilter();
    containReadTools(handle.registry, this.workDir);
    const catalog = handle.skillCatalog;
    if (!catalog) return;
    // createRemoteAgent registers LoadSkill with a fork host that spawns a
    // general-purpose subagent (write tools intact). Replace it so fork-mode
    // skills stay read-only like the rest of the chat agent.
    handle.registry.unregister("LoadSkill");
    handle.registry.register(
      new Skills.LoadSkillTool.LoadSkillTool(
        catalog,
        this.skillHost(handle),
        this.buildForkHost(handle, null, this.makePermissionCallback()),
      ),
    );
  }

  private async rehydrate(handle: Handle) {
    handle.conv.reset();
    const { messages, activeSkills } = await this.stores.loadContext(this.sessionId);
    const restored = messages.filter((m) => !isWrappedSystemReminder(m));
    if (restored.length > 0) {
      handle.conv.appendMessages(restored);
    }
    // Re-activate persisted skills from their current on-disk bodies so the
    // post-compaction context restore keeps their SOPs.
    for (const name of activeSkills) {
      const skill = handle.skillCatalog?.get(name);
      if (skill) Skills.Executor.runInline(skill, "", this.skillHost(handle));
    }
  }

  private async saveContext(handle: Handle) {
    await this.stores.saveContext(this.sessionId, handle.conv.getMessages(), [
      ...handle.activeSkills.keys(),
    ]);
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  isBusy(): boolean {
    return this.streaming || this.workerActive || this.broker.hasPending();
  }

  async attach(conn: AgentConnection) {
    this.connections.add(conn);
    this.lastActivity = Date.now();
    let handle: Handle;
    try {
      handle = await this.ensureReady();
    } catch (err) {
      conn.send(rpcNotification("agent/error", { message: describeError(err) }));
      return;
    }
    conn.send(rpcNotification("session/connected", this.connectedParams()));
    conn.send(rpcNotification("session/commands", { commands: this.commandList(handle) }));
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

  /**
   * Heartbeat sweep for this user's connections (remote parity). Without it a
   * client that vanished without a close frame stays in the set forever,
   * inflating connectionCount and blocking idle eviction — a per-user handle
   * leak in a multi-user host. Stale sockets are terminated; live ones pinged.
   */
  sweepConnections(now: number): void {
    for (const conn of [...this.connections]) {
      if (now - conn.lastSeen > HEARTBEAT_STALE_MS) {
        conn.terminate();
        this.connections.delete(conn);
        continue;
      }
      conn.ping();
    }
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

    this.refreshSkills(handle);

    // Remote parity: "/path/to/file" parses as no command (names never contain
    // "/") and must run as a plain user message, not an unknown-command error.
    if (job.content.startsWith("/") && Commands.Commands.parse(job.content) !== null) {
      await this.handleCommand(handle, job);
      return;
    }
    await this.executeAgentTurn(handle, job, job.content);
  }

  /** Streams one agent run (user message or command-produced prompt). */
  private async executeAgentTurn(handle: Handle, job: PromptJob, runText: string) {
    this.streaming = true;
    this.turnStartedAt = Date.now();
    this.notifyAll("agent/run_start", { userMessageId: job.messageId });
    this.anchorId = job.messageId;

    const adapter = new EventAdapter(() => (Date.now() - this.turnStartedAt) / 1000);
    this.activeAdapter = adapter;
    const callbacks: Remote.Server.RunCallbacks = {
      onPermissionRequest: this.makePermissionCallback(),
    };

    try {
      for await (const event of handle.run(runText, callbacks)) {
        this.eventLogger.onEvent(event);
        for (const action of adapter.map(event)) {
          if (action.kind === "notify") {
            this.notifyAll(action.method, action.params);
          } else {
            await this.flushText(job.chatSessionId, adapter);
          }
        }
      }
      if (!adapter.completed) {
        await this.flushText(job.chatSessionId, adapter);
      }
      if (adapter.cancelRequested) {
        this.notifyAll("agent/system", { message: "Stopped." });
      }
    } finally {
      this.activeAdapter = null;
      this.streaming = false;
      await this.saveContext(handle);
    }
  }

  private async flushText(chatSessionId: string, adapter: EventAdapter) {
    const text = adapter.takeStreamText();
    if (text === "") return;
    const messageId = await this.sink.saveAssistantText(this.userId, chatSessionId, text);
    if (messageId) this.anchorId = messageId;
    this.notifyAll("agent/stream_end", { text, messageId });
  }

  /* ------------------------------ slash commands ------------------------------ */

  /**
   * Registry-driven slash command dispatch (mirrors the remote server):
   * built-in commands, user commands (~/.yukino/prompts) and skill commands
   * all come from handle.cmdRegistry; only the chat-applicable subset is
   * executed, everything else gets a friendly rejection.
   */
  private async handleCommand(handle: Handle, job: PromptJob) {
    const parsed = Commands.Commands.parse(job.content);
    if (!parsed) {
      this.notifyAll("agent/error", {
        message: `Unknown command: ${job.content.split(/\s+/u)[0]} — type /help to see available commands`,
      });
      return;
    }
    const { name, args } = parsed;
    const cmd = handle.cmdRegistry.find(name);
    if (!cmd) {
      this.notifyAll("agent/error", {
        message: `Unknown command: /${name} — type /help to see available commands`,
      });
      return;
    }
    if (!this.isChatCommand(cmd)) {
      this.notifyAll("agent/system", {
        message:
          name === "plan"
            ? "Yukino is read-only in chat — plan mode is always in effect, so /plan is not needed."
            : `/${name} is not available in chat. Type /help to see available commands.`,
      });
      return;
    }

    switch (cmd.type) {
      case "local": {
        const message =
          name === "help"
            ? this.helpText(handle, args)
            : cmd.handler(this.buildCommandContext(handle, args));
        this.notifyAll("agent/system", {
          message,
          ...(name === "help" || cmd.markdown ? { markdown: true } : {}),
        });
        return;
      }
      case "local_ui":
        await this.handleLocalUiCommand(handle, name, args);
        return;
      case "prompt": {
        const prompt = cmd.handler(this.buildCommandContext(handle, args));
        if (prompt.trim() === "") return;
        await this.executeAgentTurn(handle, job, prompt);
        return;
      }
      case "skill_fork":
        await this.handleSkillFork(handle, name, args, job);
        return;
    }
  }

  /** Commands the chat host can actually serve (multi-user safe subset). */
  private isChatCommand(cmd: Commands.Commands.Command): boolean {
    switch (cmd.type) {
      case "local":
        return CHAT_LOCAL_COMMANDS.has(cmd.name.toLowerCase());
      case "local_ui":
        return CHAT_LOCAL_UI_COMMANDS.has(cmd.name.toLowerCase());
      case "prompt":
      case "skill_fork":
        return true;
      default:
        return false;
    }
  }

  /** Command list for the client's slash menu. */
  private commandList(handle: Handle): { name: string; description: string }[] {
    return handle.cmdRegistry
      .listCommands()
      .filter((cmd) => this.isChatCommand(cmd))
      .map((cmd) => ({ name: cmd.name, description: cmd.description }));
  }

  private helpText(handle: Handle, args: string): string {
    const target = args.trim();
    if (target !== "") {
      const cmd = handle.cmdRegistry.find(target.replace(/^\//u, ""));
      if (!cmd) return `Unknown command: ${target}`;
      return `\`/${cmd.name}\` — ${cmd.description}`;
    }
    const commands = handle.cmdRegistry.listCommands().filter((cmd) => this.isChatCommand(cmd));
    const builtIn = commands.filter((cmd) => !cmd.isSkill);
    const skillCount = commands.length - builtIn.length;
    const escapeCell = (value: string) => value.replace(/\|/g, "\\|");
    const rows = builtIn.map((cmd) => `| \`/${cmd.name}\` | ${escapeCell(cmd.description)} |`);
    return [
      "**Available commands**",
      "",
      "| Command | Description |",
      "| --- | --- |",
      ...rows,
      "",
      skillCount > 0
        ? `Plus ${String(skillCount)} skill command(s) — type /skills to list them.`
        : "Type `/help <command>` for details.",
    ].join("\n");
  }

  private async handleLocalUiCommand(handle: Handle, name: string, args: string) {
    switch (name) {
      case "clear": {
        handle.clearConversation();
        await this.saveContext(handle);
        this.notifyAll("session/context_cleared");
        return;
      }
      case "compact": {
        const protocol = handle.client.protocol ?? "anthropic";
        const schemas = handle.registry.getAllSchemas(protocol, handle.toolFilter ?? undefined);
        const toolNames = handle.registry.listVisibleToolNames(
          protocol,
          handle.toolFilter ?? undefined,
        );
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
          if (result.boundary) {
            Session.saveCompactBoundary(handle.cwd, handle.sessionId, result.boundary);
          }
          this.notifyAll("agent/compact", { message: result.message });
        } catch (err) {
          this.notifyAll("agent/error", { message: describeError(err) });
        }
        return;
      }
      case "skills": {
        const skills = handle.skillCatalog?.list() ?? [];
        const message =
          skills.length === 0
            ? "No skills found."
            : `Available skills (${String(skills.length)}):\n\n${skills
                .map((skill) => `  ${skill.name}: ${skill.description}`)
                .join("\n")}`;
        this.notifyAll("agent/system", { message });
        return;
      }
    }
  }

  private buildCommandContext(handle: Handle, args: string): Commands.Commands.CommandContext {
    return {
      cwd: handle.cwd,
      args,
      permissionMode: () => this.permissionMode,
      tokenCount: () => [this.lastUsage.inputTokens, this.lastUsage.outputTokens],
      toolCount: () =>
        handle.registry.listVisibleToolNames(
          handle.client.protocol ?? "anthropic",
          handle.toolFilter ?? undefined,
        ).length,
      memoryList: () =>
        handle.memoryEnabled ? handle.memoryManager.getMemories().map((m) => m.name) : [],
      model: handle.provider.model,
    };
  }

  /* ---------------------------------- skills ---------------------------------- */

  /**
   * Terminal-parity skill refresh: before a turn, pick up skill directory
   * changes, rewire the slash commands, and refresh the client's menu.
   */
  private refreshSkills(handle: Handle): void {
    const catalog = handle.skillCatalog;
    if (!catalog?.needsReload()) return;
    catalog.reload();
    Bootstrap.ToolRegistry.wireSkillsToRegistry(
      catalog,
      handle.cmdRegistry,
      this.skillHost(handle),
    );
    this.notifyAll("session/commands", { commands: this.commandList(handle) });
  }

  private skillHost(handle: Handle): Skills.SkillHost {
    return {
      activateSkill: (name, body) => {
        handle.activeSkills.set(name, body);
      },
    };
  }

  /**
   * Fork host for fork-mode skills (slash command and LoadSkill paths). The
   * subagent runs with a read-only definition against the same wrapped
   * registry, so it inherits the workspace path containment.
   */
  private buildForkHost(
    handle: Handle,
    meta: { name: string; description: string; model?: string } | null,
    onPermissionRequest: Remote.Server.RunCallbacks["onPermissionRequest"],
  ): Skills.SkillForkHost {
    const definition: Subagent.Definition.AgentDefinition = {
      name: meta?.name ?? "skill",
      description: meta?.description ?? "Read-only skill subagent for the chat agent",
      ...(meta?.model ? { model: meta.model } : {}),
      disallowedTools: [...FORK_DISALLOWED_TOOLS],
    };
    return {
      activateSkill: (name, body) => {
        handle.activeSkills.set(name, body);
      },
      snapshotParentMessages: (count) =>
        handle.conv
          .getMessages()
          .slice(-count)
          .map((message) => `[${message.role}] ${Utils.contentToText(message.content)}`)
          .join("\n"),
      runSubagent: (prompt, abortSignal, context) =>
        Subagent.Spawn.spawnSubagent(
          definition,
          prompt,
          handle.client,
          handle.registry,
          handle.provider,
          handle.cwd,
          undefined,
          undefined,
          undefined,
          context?.permissionChecker?.forCwd(handle.cwd) ?? handle.checker.forCwd(handle.cwd),
          {
            abortSignal,
            background: false,
            onPermissionRequest: context?.onPermissionRequest ?? onPermissionRequest,
          },
        ),
    };
  }

  /** Runs a fork-mode skill command in a read-only subagent. */
  private async handleSkillFork(handle: Handle, name: string, args: string, job: PromptJob) {
    const skill = handle.skillCatalog?.get(name);
    if (!skill) {
      this.notifyAll("agent/error", { message: `Skill not found: ${name}` });
      return;
    }
    const controller = new AbortController();
    this.forkController = controller;
    this.streaming = true;
    const startedAt = Date.now();
    this.notifyAll("agent/run_start", { userMessageId: job.messageId });
    this.anchorId = job.messageId;
    this.notifyAll("agent/system", { message: `Running skill "${name}" in fork mode…` });
    try {
      const forkHost = this.buildForkHost(handle, skill.meta, this.makePermissionCallback());
      const result = await Skills.Executor.runFork(skill, args, forkHost, controller.signal);
      const text = result.trim();
      if (text !== "") {
        this.notifyAll("agent/stream_text", { text });
        const messageId = await this.sink.saveAssistantText(this.userId, job.chatSessionId, text);
        if (messageId) this.anchorId = messageId;
        this.notifyAll("agent/stream_end", { text, messageId });
      }
      this.notifyAll("agent/loop_complete", {
        totalTurns: 0,
        elapsed: (Date.now() - startedAt) / 1000,
        stopReason: controller.signal.aborted ? "aborted" : "end_turn",
      });
    } catch (err) {
      if (controller.signal.aborted) {
        this.notifyAll("agent/system", { message: "Stopped." });
      } else {
        this.notifyAll("agent/error", { message: describeError(err) });
      }
    } finally {
      this.forkController = null;
      this.streaming = false;
      await this.saveContext(handle);
    }
  }

  /* ------------------------------- interactions ------------------------------- */

  private makePermissionCallback(): Remote.Server.RunCallbacks["onPermissionRequest"] {
    return async (toolName, args, decision, _toolCallId, signal, source) => {
      // Remote-parity description: subagent source + rule reason + tool action.
      const parts: string[] = [];
      if (source) parts.push(`${source.agentName} · ${source.cwd}`);
      if (decision.reason !== "") parts.push(decision.reason);
      const action = this.describer.describeToolAction(toolName, args);
      if (action !== "") parts.push(action);
      const params: PermissionRequestParams = {
        id: `perm_${process.hrtime.bigint()}`,
        toolName,
        description: parts.join("\n"),
      };
      this.notifyAll("permission/request", params as never);
      // The abort signal lets a library-internal cancel (not just the user's
      // stop button) settle the prompt immediately instead of pinning the run
      // until the interaction timeout.
      return this.broker.requestPermission(params, signal);
    };
  }

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

  resolvePermission(id: string, decision: "allow" | "deny" | "allowAlways"): boolean {
    return this.broker.resolvePermission(id, decision);
  }

  resolveQuestion(id: string, answers: Record<string, string>): boolean {
    return this.broker.resolveQuestion(id, answers);
  }

  cancel() {
    if (this.activeAdapter) this.activeAdapter.cancelRequested = true;
    this.forkController?.abort();
    this.handle?.abort();
    this.broker.cancelAll("run cancelled");
  }

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

/**
 * Per-user agent workspace. The userId becomes a filesystem path segment, so
 * it is reduced to a safe token first — a crafted id must not be able to
 * traverse into another user's workspace (defense-in-depth for the
 * multi-user host).
 */
export function makeWorkDir(root: string, userId: string): string {
  return path.join(root, ".yukino", "chat", safeSegment(userId));
}

function safeSegment(userId: string): string {
  const cleaned = userId.replace(/[^A-Za-z0-9_-]/gu, "");
  return cleaned === "" ? "anonymous" : cleaned;
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

/**
 * Console-backed EventLogger for Remote.Log.AgentEventLogger. Emits one JSON
 * line per noteworthy event with the owning user attached, so interleaved
 * multi-user streams stay attributable.
 */
function consoleEventLogger(userId: string): Remote.Log.EventLogger {
  const write =
    (level: "warn" | "error") =>
    (obj: Record<string, unknown>): void => {
      const line = JSON.stringify({ level, module: "agent", userId, ...obj });
      if (level === "error") console.error(line);
      else console.warn(line);
    };
  return { warn: write("warn"), error: write("error") };
}
