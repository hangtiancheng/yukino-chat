import type { Conversation } from "@yukino.js/yukino";
import type { PrismaDB } from "../database/prisma.js";

interface AgentSessionRow {
  id: string;
  userId: string;
  context: unknown;
  activeSkills: unknown;
  permissionMode: string;
}

export interface AgentContext {
  messages: Conversation.Message[];
}

export class AgentStores {
  constructor(private readonly db: PrismaDB) {}

  async getOrCreateSession(userId: string, permissionMode: string): Promise<AgentSessionRow> {
    const existing = await this.db.agentSession.findUnique({ where: { userId } });
    if (existing) {
      if (existing.status === "RUNNING" || existing.status === "WAITING") {
        await this.db.agentSession
          .update({ where: { id: existing.id }, data: { status: "IDLE" } })
          .catch(() => {});
      }
      return existing;
    }
    return this.db.agentSession.create({
      data: { userId, permissionMode, status: "IDLE" },
    });
  }

  async loadContext(sessionId: string): Promise<AgentContext> {
    const row = await this.db.agentSession.findUnique({
      where: { id: sessionId },
      select: { context: true },
    });
    if (!row) return { messages: [] };
    const ctx = row.context as { messages?: unknown };
    if (!ctx || !Array.isArray(ctx.messages)) return { messages: [] };
    return { messages: ctx.messages as Conversation.Message[] };
  }

  async saveContext(
    sessionId: string,
    messages: Conversation.Message[],
    activeSkills: string[],
  ): Promise<void> {
    await this.db.agentSession
      .update({
        where: { id: sessionId },
        data: {
          context: { messages } as never,
          activeSkills: activeSkills as never,
          lastActiveTime: new Date(),
        },
      })
      .catch(() => {});
  }
}
