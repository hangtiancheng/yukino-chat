import { AgentManager } from "./agent/agent-manager.js";
import { CacheService } from "./cache/cache-service.js";
import { issueToken } from "./common/token.js";
import { createPrismaClient, type PrismaDB } from "./database/prisma.js";
import { CallManager } from "./hub/call-manager.js";
import { ChatHub } from "./hub/chat-hub.js";
import { ContactService } from "./services/contact-service.js";
import { GroupService } from "./services/group-service.js";
import { MessageService } from "./services/message-service.js";
import { SessionService } from "./services/session-service.js";
import { UserService } from "./services/user-service.js";

// Dependency bag threaded through routes; wired once in createDeps().
export interface Deps {
  db: PrismaDB;
  cache: CacheService;
  calls: CallManager;
  hub: ChatHub;
  sessions: SessionService;
  users: UserService;
  contacts: ContactService;
  groups: GroupService;
  messages: MessageService;
  agent: AgentManager;
}

export function createDeps(): Deps {
  const db = createPrismaClient();
  const cache = new CacheService();
  const calls = new CallManager();
  const hub = new ChatHub(db, calls);
  const sessions = new SessionService(db, cache);
  const users = new UserService(db, cache, sessions, issueToken);
  const contacts = new ContactService(db, cache, sessions, hub);
  const groups = new GroupService(db, sessions, hub, contacts);
  const messages = new MessageService(db);
  const agent = new AgentManager(db, hub);
  return { db, cache, calls, hub, sessions, users, contacts, groups, messages, agent };
}

export async function shutdownDeps(deps: Deps) {
  deps.agent.disposeAll();
  deps.hub.stop();
  await deps.cache.close();
  await deps.db.$disconnect();
}
