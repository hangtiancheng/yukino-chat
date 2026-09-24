import type { CacheService } from "../cache/cache-service.js";
import { isYukino, newSession } from "../common/ids.js";
import { fmtDateTime } from "../common/time.js";
import type { PrismaDB } from "../database/prisma.js";
import type { GroupInfo, Message, Session } from "../generated/prisma/client.js";
import {
  ContactBeBlack,
  ContactBlack,
  GroupStatusDisable,
  MessageAudioOrVideo,
  MessageFile,
  MessageImage,
  MessageVideo,
  UserStatusDisable,
} from "../hub/frame-types.js";

// Wire shapes.
export interface UserSessionItem {
  session_id: string;
  avatar: string;
  user_id: string;
  username: string;
  last_message: string;
  last_message_type: number;
  last_message_at: string;
  last_message_at_ms: number;
  unread_cnt: number;
}

export interface GroupSessionItem {
  session_id: string;
  avatar: string;
  group_id: string;
  group_name: string;
  last_message: string;
  last_message_type: number;
  last_message_at: string;
  last_message_at_ms: number;
  unread_cnt: number;
}

interface SessionMeta {
  lastMessage: string;
  lastMessageType: number;
  lastMessageAt: string;
  lastMessageAtMs: number;
  unreadCnt: number;
  sortKey: number;
}

// Cached session rows keep only the fields the list endpoints need; timestamps
// are epoch millis so JSON round-trips are lossless.
export interface CachedSession {
  uuid: string;
  receiveId: string;
  receiveName: string;
  avatar: string;
  createdAtMs: number;
  lastReadAtMs: number | null;
}

const toCached = (s: Session): CachedSession => ({
  uuid: s.uuid,
  receiveId: s.receiveId,
  receiveName: s.receiveName,
  avatar: s.avatar,
  createdAtMs: s.createdAt.getTime(),
  lastReadAtMs: s.lastReadAt ? s.lastReadAt.getTime() : null,
});

const fromCached = (c: CachedSession): Session =>
  ({
    uuid: c.uuid,
    receiveId: c.receiveId,
    receiveName: c.receiveName,
    avatar: c.avatar,
    createdAt: new Date(c.createdAtMs),
    lastReadAt: c.lastReadAtMs === null ? null : new Date(c.lastReadAtMs),
  }) as Session;

export class SessionService {
  constructor(
    private readonly db: PrismaDB,
    private readonly cache: CacheService,
  ) {}

  messagePreview(m: Message): string {
    switch (m.type) {
      case MessageImage:
        return "[Image]";
      case MessageVideo:
        return "[Video]";
      case MessageFile:
        return m.fileName !== "" ? `[File] ${m.fileName}` : "[File]";
      default:
        return m.content;
    }
  }

  // Computes the latest visible message and the unread count for one session.
  // AV signaling frames (type 3) never surface in previews.
  private async enrichSession(ownerId: string, s: Session): Promise<SessionMeta> {
    const meta: SessionMeta = {
      lastMessage: "",
      lastMessageType: 0,
      lastMessageAt: "",
      lastMessageAtMs: 0,
      unreadCnt: 0,
      sortKey: s.createdAt.getTime(),
    };

    const isGroup = s.receiveId.startsWith("G");
    const base = { type: { not: MessageAudioOrVideo } };
    const latest = await this.db.message.findFirst({
      where: isGroup
        ? { ...base, receiveId: s.receiveId }
        : {
            ...base,
            OR: [
              { sendId: ownerId, receiveId: s.receiveId },
              { sendId: s.receiveId, receiveId: ownerId },
            ],
          },
      orderBy: { createdAt: "desc" },
    });
    if (latest) {
      meta.lastMessage = this.messagePreview(latest);
      meta.lastMessageType = latest.type;
      meta.lastMessageAt = fmtDateTime(latest.createdAt);
      meta.lastMessageAtMs = latest.createdAt.getTime();
      meta.sortKey = meta.lastMessageAtMs;
    }

    const unreadWhere = isGroup
      ? { ...base, receiveId: s.receiveId, sendId: { not: ownerId } }
      : { ...base, sendId: s.receiveId, receiveId: ownerId };
    if (s.lastReadAt) {
      Object.assign(unreadWhere, { createdAt: { gt: s.lastReadAt } });
    }
    meta.unreadCnt = await this.db.message.count({ where: unreadWhere });
    return meta;
  }

  private async enrichAll(
    ownerId: string,
  ): Promise<{ user: UserSessionItem[] | null; group: GroupSessionItem[] | null }> {
    const sessions = await this.loadSessions(ownerId);
    const userEntries: { key: number; item: UserSessionItem }[] = [];
    const groupEntries: { key: number; item: GroupSessionItem }[] = [];
    for (const s of sessions) {
      const meta = await this.enrichSession(ownerId, s);
      const common = {
        session_id: s.uuid,
        avatar: s.avatar,
        last_message: meta.lastMessage,
        last_message_type: meta.lastMessageType,
        last_message_at: meta.lastMessageAt,
        last_message_at_ms: meta.lastMessageAtMs,
        unread_cnt: meta.unreadCnt,
      };
      if (s.receiveId.startsWith("G")) {
        groupEntries.push({
          key: meta.sortKey,
          item: { ...common, group_id: s.receiveId, group_name: s.receiveName },
        });
      } else {
        userEntries.push({
          key: meta.sortKey,
          item: { ...common, user_id: s.receiveId, username: s.receiveName },
        });
      }
    }
    // V8's Array.prototype.sort is stable.
    userEntries.sort((a, b) => b.key - a.key);
    groupEntries.sort((a, b) => b.key - a.key);
    return {
      user: userEntries.map((e) => e.item),
      group: groupEntries.map((e) => e.item),
    };
  }

  async getUserSessionList(ownerId: string): Promise<[string, UserSessionItem[] | null, number]> {
    return ["success", (await this.enrichAll(ownerId)).user, 0];
  }

  async getGroupSessionList(ownerId: string): Promise<[string, GroupSessionItem[] | null, number]> {
    return ["success", (await this.enrichAll(ownerId)).group, 0];
  }

  // Drops the cached session list of every user that has a session pointing
  // at the given receiver.
  async invalidateSessionCacheByReceiver(receiveId: string) {
    const owners = await this.db.session.findMany({
      where: { receiveId, deletedAt: null },
      select: { sendId: true },
      distinct: ["sendId"],
    });
    for (const o of owners) {
      await this.cache.deleteSessionList(o.sendId);
    }
  }

  async openSession(sendId: string, receiveId: string): Promise<[string, string, number]> {
    if (sendId === "" || receiveId === "") {
      return ["send_id and receive_id are required", "", -2];
    }
    const existing = await this.db.session.findFirst({
      where: { sendId, receiveId, deletedAt: null },
    });
    if (existing) return ["session created", existing.uuid, 0];
    return this.createSession(sendId, receiveId);
  }

  async createSession(sendId: string, receiveId: string): Promise<[string, string, number]> {
    const data: {
      uuid: string;
      sendId: string;
      receiveId: string;
      receiveName?: string;
      avatar?: string;
    } = { uuid: newSession(), sendId, receiveId };

    if (receiveId.startsWith("U")) {
      const user = await this.db.userInfo.findFirst({
        where: { uuid: receiveId, deletedAt: null },
      });
      if (!user) return ["Internal Server Error", "", -1];
      data.receiveName = user.nickname;
      data.avatar = user.avatar;
    } else {
      const group = await this.db.groupInfo.findFirst({
        where: { uuid: receiveId, deletedAt: null },
      });
      if (!group) return ["Internal Server Error", "", -1];
      data.receiveName = group.name;
      data.avatar = group.avatar;
    }

    try {
      const session = await this.db.session.create({ data });
      await this.cache.deleteSessionList(sendId);
      return ["session created", session.uuid, 0];
    } catch {
      return ["Internal Server Error", "", -1];
    }
  }

  // Returns the caller's active sessions, served through the read-through
  // session cache.
  async loadSessions(ownerId: string): Promise<Session[]> {
    const cached = await this.cache.getSessionList<CachedSession[]>(ownerId);
    if (cached) return cached.map(fromCached);
    const sessions = await this.db.session.findMany({
      where: { sendId: ownerId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    await this.cache.setSessionList(ownerId, sessions.map(toCached));
    return sessions;
  }

  async deleteSession(ownerId: string, sessionId: string): Promise<[string, number]> {
    const target = await this.db.session.findFirst({ where: { uuid: sessionId } });
    if (!target) return ["Internal Server Error", -1];
    if (isYukino(target.receiveId)) {
      return ["the Yukino session cannot be deleted", -2];
    }
    if (target.sendId !== ownerId) {
      return ["you can only delete your own sessions", -2];
    }
    await this.db.session.update({
      where: { uuid: sessionId },
      data: { deletedAt: new Date() },
    });
    await this.cache.deleteSessionList(ownerId);
    return ["deleted", 0];
  }

  async markSessionRead(ownerId: string, receiveId: string): Promise<[string, number]> {
    if (ownerId === "" || receiveId === "") {
      return ["owner_id and receive_id are required", -2];
    }
    await this.db.session.updateMany({
      where: { sendId: ownerId, receiveId, deletedAt: null },
      data: { lastReadAt: new Date() },
    });
    await this.cache.deleteSessionList(ownerId);
    return ["marked as read", 0];
  }

  // Guarantees the owner has an active session pointing at peer, restoring a
  // soft-deleted one or creating it from the peer's profile.
  async ensurePeerSession(ownerId: string, peerId: string) {
    const session = await this.db.session.findFirst({
      where: { sendId: ownerId, receiveId: peerId },
    });
    if (!session) {
      await this.createSession(ownerId, peerId);
      return;
    }
    if (session.deletedAt) {
      await this.db.session.update({
        where: { uuid: session.uuid },
        data: { deletedAt: null },
      });
      await this.cache.deleteSessionList(ownerId);
    }
  }

  // Makes a direct message surface in both participants' session lists.
  async touchDirectSessions(sendId: string, receiveId: string) {
    await this.ensurePeerSession(sendId, receiveId);
    await this.ensurePeerSession(receiveId, sendId);
  }

  // Guarantees every group member has an active session for the group,
  // restoring soft-deleted ones and creating missing ones in bulk.
  async touchGroupSessions(group: GroupInfo) {
    if (group.members.length === 0) return;
    const existing = await this.db.session.findMany({
      where: { receiveId: group.uuid, sendId: { in: group.members } },
    });
    const byOwner = new Map(existing.map((s) => [s.sendId, s]));

    const affected: string[] = [];
    const restoreUuids: string[] = [];
    const created: {
      uuid: string;
      sendId: string;
      receiveId: string;
      receiveName: string;
      avatar: string;
    }[] = [];
    for (const member of group.members) {
      const s = byOwner.get(member);
      if (!s) {
        created.push({
          uuid: newSession(),
          sendId: member,
          receiveId: group.uuid,
          receiveName: group.name,
          avatar: group.avatar,
        });
        affected.push(member);
      } else if (s.deletedAt) {
        restoreUuids.push(s.uuid);
        affected.push(member);
      }
    }
    if (restoreUuids.length > 0) {
      await this.db.session.updateMany({
        where: { uuid: { in: restoreUuids } },
        data: { deletedAt: null },
      });
    }
    if (created.length > 0) {
      await this.db.session.createMany({ data: created });
    }
    for (const member of affected) {
      await this.cache.deleteSessionList(member);
    }
  }

  async checkOpenSessionAllowed(
    sendId: string,
    receiveId: string,
  ): Promise<[string, boolean, number]> {
    if (sendId === "" || receiveId === "") {
      return ["send_id and receive_id are required", false, -2];
    }
    const contact = await this.db.userContact.findFirst({
      where: { userId: sendId, contactId: receiveId, deletedAt: null },
    });
    if (!contact) return ["Internal Server Error", false, -1];
    if (contact.status === ContactBeBlack) {
      return ["blocked by the other user", false, -2];
    }
    if (contact.status === ContactBlack) {
      return ["unblock the user first", false, -2];
    }
    if (receiveId.startsWith("U")) {
      const user = await this.db.userInfo.findFirst({
        where: { uuid: receiveId, deletedAt: null },
      });
      if (!user) return ["Internal Server Error", false, -1];
      if (user.status === UserStatusDisable) {
        return ["target user is disabled", false, -2];
      }
    } else {
      const group = await this.db.groupInfo.findFirst({
        where: { uuid: receiveId, deletedAt: null },
      });
      if (!group) return ["Internal Server Error", false, -1];
      if (group.status === GroupStatusDisable) {
        return ["target group is disabled", false, -2];
      }
    }
    return ["allowed", true, 0];
  }
}
