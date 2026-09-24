import path from "node:path";
import { newMessage, YUKINO_NAME, YUKINO_UUID } from "../common/ids.js";
import { fmtDateTime, nowDate } from "../common/time.js";
import { env } from "../config/env.js";
import type { PrismaDB } from "../database/prisma.js";
import type { ChatHub } from "../hub/chat-hub.js";
import { AgentRuntime, type ChatSink } from "./agent-runtime.js";
import { AgentStores } from "./agent-stores.js";
import { loadAgentConfig } from "./yukino-config.js";

const IDLE_SWEEP_INTERVAL_MS = 60_000;

// Registry of per-user agent runtimes: lazy creation, idle eviction (30 min,
// like the Go bridge's sweep), and the chat-message sink that files assistant
// replies as ordinary messages.
export class AgentManager {
  private runtimes = new Map<string, AgentRuntime>();
  private readonly stores: AgentStores;
  private readonly sink: ChatSink;
  private sweepTimer: NodeJS.Timeout | null = null;
  readonly available: boolean;

  constructor(
    private readonly db: PrismaDB,
    private readonly hub: ChatHub,
  ) {
    this.stores = new AgentStores(db);
    this.available = loadAgentConfig() !== null;
    this.sink = this.makeSink();
  }

  start() {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweepIdle(), IDLE_SWEEP_INTERVAL_MS);
  }

  private sweepIdle() {
    const now = Date.now();
    for (const [uuid, runtime] of this.runtimes) {
      if (
        !runtime.isBusy() &&
        runtime.connectionCount === 0 &&
        now - runtime.lastActivity > env.AGENT_IDLE_MS
      ) {
        this.runtimes.delete(uuid);
        void runtime.dispose();
      }
    }
  }

  async getOrCreate(userId: string): Promise<AgentRuntime> {
    let runtime = this.runtimes.get(userId);
    if (!runtime) {
      const config = loadAgentConfig();
      if (!config) {
        throw new Error("Yukino is not configured on this server");
      }
      runtime = new AgentRuntime({
        userId,
        workDir: path.join(process.cwd(), ".yukino", "chat", userId),
        config,
        stores: this.stores,
        sink: this.sink,
      });
      this.runtimes.set(userId, runtime);
    }
    return runtime;
  }

  // Files the assistant's reply as an ordinary chat message and broadcasts it
  // on the chat socket — the same insert-and-broadcast path a human peer
  // takes, which is what gives Yukino working history, session previews and
  // unread counts for free. Returns the message uuid for stream_end.
  private makeSink(): ChatSink {
    return {
      saveAssistantText: async (userId, chatSessionId, text) => {
        let name = YUKINO_NAME;
        let avatar = "";
        const user = await this.db.userInfo.findFirst({
          where: { uuid: YUKINO_UUID },
        });
        if (user) {
          name = user.nickname;
          avatar = user.avatar;
        }
        try {
          const msg = await this.db.message.create({
            data: {
              uuid: newMessage(),
              sessionId: chatSessionId,
              type: 0,
              content: text,
              sendId: YUKINO_UUID,
              sendName: name,
              sendAvatar: avatar,
              receiveId: userId,
              status: 0,
              createdAt: nowDate(),
            },
          });
          this.hub.sendRaw(
            JSON.stringify({
              uuid: msg.uuid,
              send_id: msg.sendId,
              send_name: msg.sendName,
              send_avatar: msg.sendAvatar,
              receive_id: msg.receiveId,
              type: msg.type,
              content: msg.content,
              url: msg.url,
              file_size: msg.fileSize,
              file_name: msg.fileName,
              file_type: msg.fileType,
              created_at: fmtDateTime(msg.createdAt),
            }),
            [userId],
          );
          return msg.uuid;
        } catch {
          return "";
        }
      },
    };
  }

  // Routes a stored direct message into the runtime owned by its sender.
  dispatch(userId: string, chatSessionId: string, messageId: string, content: string) {
    void this.getOrCreate(userId)
      .then((runtime) => runtime.dispatch({ chatSessionId, messageId, content }))
      .catch((err) => {
        // Unconfigured or failed runtime: answer as a chat message so the
        // assistant thread reports itself unavailable.
        void this.sink.saveAssistantText(
          userId,
          chatSessionId,
          "I can't reply right now — Yukino is not configured on this server.",
        );
        console.error("AgentManager.dispatch:", err instanceof Error ? err.message : err);
      });
  }

  saveAssistantText(userId: string, chatSessionId: string, text: string): Promise<string> {
    return this.sink.saveAssistantText(userId, chatSessionId, text);
  }

  disposeAll() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    for (const [uuid, runtime] of this.runtimes) {
      this.runtimes.delete(uuid);
      void runtime.dispose();
    }
  }
}
