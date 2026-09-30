import { newGroup, newMessage } from "../common/ids.js";
import { fmtDateTime } from "../common/time.js";
import type { PrismaDB } from "../database/prisma.js";
import type { GroupInfo } from "../generated/prisma/client.js";
import type { ChatHub } from "../hub/chat-hub.js";
import {
  ContactKicked,
  ContactNormal,
  ContactQuit,
  ContactTypeGroup,
  GroupAddModeDirect,
  GroupAddModeReview,
  GroupStatusDisable,
  GroupStatusDismiss,
  GroupStatusNormal,
  MessageSent,
  MessageText,
  NotifyGroup,
  NotifySession,
} from "../hub/frame-types.js";
import type { ContactService } from "./contact-service.js";
import { addGroupMember, ensureGroupContact, removeGroupMember } from "./contact-service.js";
import type { SessionService } from "./session-service.js";

export interface GroupInfoResponse {
  uuid: string;
  name: string;
  notice: string;
  members: string[];
  member_cnt: number;
  owner_id: string;
  add_mode: number;
  avatar: string;
  status: number;
}

export interface GroupListItem {
  group_id: string;
  name: string;
  member_cnt: number;
  owner_id: string;
  avatar: string;
}

export interface AdminGroupItem {
  group_id: string;
  name: string;
  member_cnt: number;
  owner_id: string;
  avatar: string;
  status: number;
  is_deleted: boolean;
}

export interface GroupMemberItem {
  user_id: string;
  uuid: string;
  nickname: string;
  avatar: string;
  is_owner: boolean;
  joined_at: string;
  last_message_at: string;
}

export interface SearchGroupItem {
  group_id: string;
  name: string;
  avatar: string;
  member_cnt: number;
  add_mode: number;
  is_joined: boolean;
}

const toGroupInfoResponse = (g: {
  uuid: string;
  name: string;
  notice: string;
  members: string[];
  memberCnt: number;
  ownerId: string;
  addMode: number;
  avatar: string;
  status: number;
}): GroupInfoResponse => ({
  uuid: g.uuid,
  name: g.name,
  notice: g.notice,
  members: g.members,
  member_cnt: g.memberCnt,
  owner_id: g.ownerId,
  add_mode: g.addMode,
  avatar: g.avatar,
  status: g.status,
});

export class GroupService {
  constructor(
    private readonly db: PrismaDB,
    private readonly sessions: SessionService,
    private readonly hub: ChatHub,
    private readonly memberships: ContactService,
  ) {}

  async createGroup(
    name: string,
    ownerId: string,
    avatar: string,
    notice: string,
    addMode: number,
    memberIds: string[],
  ): Promise<[string, GroupInfoResponse | null, number]> {
    if (addMode !== GroupAddModeDirect && addMode !== GroupAddModeReview) {
      return ["invalid add_mode", null, -2];
    }

    // Only existing, active users besides the owner become initial members.
    const members = [ownerId];
    if (memberIds.length > 0) {
      const users = await this.db.userInfo.findMany({
        where: { uuid: { in: memberIds }, deletedAt: null },
      });
      for (const u of users) {
        if (u.uuid !== ownerId && !members.includes(u.uuid)) {
          members.push(u.uuid);
        }
      }
    }

    const groupAvatar = avatar === "" ? "https://vitejs.dev/logo.svg" : avatar;

    let group: GroupInfo;
    try {
      group = await this.db.$transaction(async (tx) => {
        const created = await tx.groupInfo.create({
          data: {
            uuid: newGroup(),
            name,
            notice,
            members,
            memberCnt: members.length,
            ownerId,
            addMode,
            avatar: groupAvatar,
            status: GroupStatusNormal,
          },
        });
        const now = new Date();
        for (const member of members) {
          await tx.userContact.create({
            data: {
              userId: member,
              contactId: created.uuid,
              contactType: ContactTypeGroup,
              status: ContactNormal,
              createdAt: now,
              updatedAt: now,
            },
          });
        }
        return created;
      });
    } catch {
      return ["Internal Server Error", null, -1];
    }

    // A welcome message keeps the fresh group visible in session previews.
    let sendName = "";
    let sendAvatar = "";
    const owner = await this.db.userInfo.findFirst({
      where: { uuid: ownerId, deletedAt: null },
    });
    if (owner) {
      sendName = owner.nickname;
      sendAvatar = owner.avatar;
    }
    await this.db.message
      .create({
        data: {
          uuid: newMessage(),
          sessionId: "",
          type: MessageText,
          content: `Welcome to ${name}!`,
          sendId: ownerId,
          sendName,
          sendAvatar,
          receiveId: group.uuid,
          status: MessageSent,
        },
      })
      .catch(() => {});
    await this.sessions.touchGroupSessions(group);
    for (const member of members) {
      if (member !== ownerId) {
        this.hub.pushSystem(NotifyGroup, [member]);
      }
      this.hub.pushSystem(NotifySession, [member]);
    }

    return ["group created", toGroupInfoResponse(group), 0];
  }

  async getGroupInfo(uuid: string): Promise<[string, GroupInfoResponse | null, number]> {
    const group = await this.db.groupInfo.findFirst({
      where: { uuid, deletedAt: null },
    });
    if (!group) return ["Internal Server Error", null, -1];
    return ["group info retrieved", toGroupInfoResponse(group), 0];
  }

  async loadMyGroup(ownerId: string): Promise<[string, GroupListItem[] | null, number]> {
    const groups = await this.db.groupInfo.findMany({
      where: { ownerId, deletedAt: null },
    });
    return [
      "success",
      groups.map((g) => ({
        group_id: g.uuid,
        name: g.name,
        member_cnt: g.memberCnt,
        owner_id: g.ownerId,
        avatar: g.avatar,
      })),
      0,
    ];
  }

  async checkGroupAddMode(groupId: string): Promise<[string, number, number]> {
    const group = await this.db.groupInfo.findFirst({
      where: { uuid: groupId, deletedAt: null },
    });
    if (!group) return ["Internal Server Error", 0, -1];
    return ["success", group.addMode, 0];
  }

  async enterGroupDirectly(userId: string, groupId: string): Promise<[string, number]> {
    const group = await this.db.groupInfo.findFirst({
      where: { uuid: groupId, deletedAt: null },
    });
    if (!group) return ["Internal Server Error", -1];
    if (group.status === GroupStatusDisable) return ["group is disabled", -2];
    if (group.addMode !== GroupAddModeDirect) {
      return ["group requires owner approval", -2];
    }
    if (group.members.includes(userId)) {
      return ["already a group member", -2];
    }

    const added = await addGroupMember(this.db, groupId, userId);
    if (!added) return ["Internal Server Error", -1];
    await ensureGroupContact(this.db, userId, groupId);
    return ["joined group", 0];
  }

  // Adds the given users to the group, skipping the ones already in it.
  async inviteGroupMembers(groupId: string, memberIds: string[]): Promise<[string, number]> {
    const group = await this.db.groupInfo.findFirst({
      where: { uuid: groupId, deletedAt: null },
    });
    if (!group) return ["Internal Server Error", -1];
    if (group.status === GroupStatusDisable) return ["group is disabled", -2];

    const candidates: string[] = [];
    for (const id of memberIds) {
      if (!group.members.includes(id) && !candidates.includes(id)) {
        candidates.push(id);
      }
    }
    if (candidates.length === 0) {
      return ["all selected users are already group members", -2];
    }
    const users = await this.db.userInfo.findMany({
      where: { uuid: { in: candidates }, deletedAt: null },
    });
    const newcomers = users.map((u) => u.uuid);
    if (newcomers.length === 0) return ["no valid users to invite", -2];

    for (const id of newcomers) {
      await addGroupMember(this.db, groupId, id);
      await ensureGroupContact(this.db, id, groupId);
    }
    // Refresh the members array before creating sessions for everyone.
    const updated = await this.db.groupInfo.findFirst({
      where: { uuid: groupId, deletedAt: null },
    });
    if (updated) {
      await this.sessions.touchGroupSessions(updated);
    }
    this.hub.pushSystem(NotifyGroup, newcomers);
    this.hub.pushSystem(NotifySession, newcomers);
    return ["members invited", 0];
  }

  // Finds groups by name keyword, flagging the ones the caller has joined.
  async searchGroups(
    ownerId: string,
    keyword: string,
  ): Promise<[string, SearchGroupItem[] | null, number]> {
    keyword = keyword.trim();
    if (keyword === "") return ["keyword is required", null, -2];
    const groups = await this.db.groupInfo.findMany({
      where: {
        status: GroupStatusNormal,
        deletedAt: null,
        name: { contains: keyword, mode: "insensitive" },
      },
      take: 20,
    });
    return [
      "success",
      groups.map((g) => ({
        group_id: g.uuid,
        name: g.name,
        avatar: g.avatar,
        member_cnt: g.memberCnt,
        add_mode: g.addMode,
        is_joined: g.members.includes(ownerId),
      })),
      0,
    ];
  }

  async leaveGroup(userId: string, groupId: string): Promise<[string, number]> {
    const group = await this.db.groupInfo.findFirst({
      where: { uuid: groupId, deletedAt: null },
    });
    if (!group) return ["Internal Server Error", -1];
    if (group.ownerId === userId) {
      return ["owner cannot leave the group, dismiss it instead", -2];
    }
    const removed = await removeGroupMember(this.db, groupId, userId);
    if (!removed) return ["Internal Server Error", -1];
    await this.memberships.cleanupGroupMembership(userId, groupId, ContactQuit);
    return ["left group", 0];
  }

  async dismissGroup(userId: string, groupId: string): Promise<[string, number]> {
    const group = await this.db.groupInfo.findFirst({
      where: { uuid: groupId, deletedAt: null },
    });
    if (!group) return ["Internal Server Error", -1];
    if (group.ownerId !== userId) {
      return ["only the group owner can dismiss the group", -2];
    }
    await this.db.$transaction(async (tx) => {
      await tx.groupInfo.update({
        where: { uuid: groupId },
        data: { status: GroupStatusDismiss, deletedAt: new Date() },
      });
      const now = new Date();
      await tx.session.updateMany({
        where: { receiveId: groupId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.userContact.updateMany({
        where: { contactId: groupId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.contactApply.updateMany({
        where: { contactId: groupId, deletedAt: null },
        data: { deletedAt: now },
      });
    });
    await this.sessions.invalidateSessionCacheByReceiver(groupId);
    this.hub.pushSystem(NotifyGroup, group.members);
    this.hub.pushSystem(NotifySession, group.members);
    return ["group dismissed", 0];
  }

  async updateGroupInfo(
    userId: string,
    uuid: string,
    fields: { name?: string; notice?: string; avatar?: string; addMode?: number },
  ): Promise<[string, number]> {
    if (Object.keys(fields).length === 0) return ["group info updated", 0];
    const group = await this.db.groupInfo.findFirst({
      where: { uuid, deletedAt: null },
    });
    if (!group) return ["Internal Server Error", -1];
    if (group.ownerId !== userId) {
      return ["only the group owner can update the group info", -2];
    }
    const data = { ...fields };
    await this.db.groupInfo.update({ where: { uuid }, data });

    // Keep the denormalized session fields in sync with the group profile.
    const sessionFields: { receiveName?: string; avatar?: string } = {};
    if (fields.name !== undefined) sessionFields.receiveName = fields.name;
    if (fields.avatar !== undefined) sessionFields.avatar = fields.avatar;
    if (Object.keys(sessionFields).length > 0) {
      await this.db.session.updateMany({
        where: { receiveId: uuid, deletedAt: null },
        data: sessionFields,
      });
      await this.sessions.invalidateSessionCacheByReceiver(uuid);
    }
    return ["group info updated", 0];
  }

  async getGroupMemberList(groupId: string): Promise<[string, GroupMemberItem[] | null, number]> {
    const group = await this.db.groupInfo.findFirst({
      where: { uuid: groupId, deletedAt: null },
    });
    if (!group) return ["Internal Server Error", null, -1];
    const users = await this.db.userInfo.findMany({
      where: { uuid: { in: group.members }, deletedAt: null },
    });

    // Join time comes from the member's group contact record; the owner's is
    // the group creation time.
    const joinedAt = new Map<string, Date>();
    const contacts = await this.db.userContact.findMany({
      where: { contactId: groupId, userId: { in: group.members }, deletedAt: null },
    });
    for (const c of contacts) {
      joinedAt.set(c.userId, c.createdAt);
    }
    joinedAt.set(group.ownerId, group.createdAt);

    // Last-speak time per member over the group's visible messages.
    const lastSpoke = new Map<string, Date>();
    const rows = await this.db.message.groupBy({
      by: ["sendId"],
      where: {
        receiveId: groupId,
        type: { not: 3 },
        sendId: { in: group.members },
      },
      _max: { createdAt: true },
    });
    for (const r of rows) {
      if (r._max.createdAt) lastSpoke.set(r.sendId, r._max.createdAt);
    }

    const list: GroupMemberItem[] = users.map((u) => ({
      user_id: u.uuid,
      uuid: u.uuid,
      nickname: u.nickname,
      avatar: u.avatar,
      is_owner: u.uuid === group.ownerId,
      joined_at: joinedAt.has(u.uuid) ? fmtDateTime(joinedAt.get(u.uuid) as Date) : "",
      last_message_at: lastSpoke.has(u.uuid) ? fmtDateTime(lastSpoke.get(u.uuid) as Date) : "",
    }));
    return ["success", list, 0];
  }

  async removeGroupMembers(
    userId: string,
    groupId: string,
    memberIds: string[],
  ): Promise<[string, number]> {
    const group = await this.db.groupInfo.findFirst({
      where: { uuid: groupId, deletedAt: null },
    });
    if (!group) return ["Internal Server Error", -1];
    if (group.ownerId !== userId) {
      return ["only the group owner can remove members", -2];
    }
    if (memberIds.includes(group.ownerId)) {
      return ["cannot remove the group owner", -2];
    }

    const remaining = group.members.filter((m) => !memberIds.includes(m));
    await this.db.groupInfo.update({
      where: { uuid: groupId },
      data: { members: remaining, memberCnt: remaining.length, updatedAt: new Date() },
    });

    for (const id of memberIds) {
      await this.memberships.cleanupGroupMembership(id, groupId, ContactKicked);
    }
    this.hub.pushSystem(NotifyGroup, memberIds);
    this.hub.pushSystem(NotifySession, memberIds);
    return ["members removed", 0];
  }

  async getGroupInfoList(): Promise<[string, AdminGroupItem[] | null, number]> {
    const groups = await this.db.groupInfo.findMany();
    return [
      "success",
      groups.map((g) => ({
        group_id: g.uuid,
        name: g.name,
        member_cnt: g.memberCnt,
        owner_id: g.ownerId,
        avatar: g.avatar,
        status: g.status,
        is_deleted: g.deletedAt !== null,
      })),
      0,
    ];
  }

  async deleteGroups(uuidList: string[]): Promise<[string, number]> {
    await this.db.groupInfo.updateMany({
      where: { uuid: { in: uuidList } },
      data: { deletedAt: new Date() },
    });
    for (const uuid of uuidList) {
      const now = new Date();
      await this.sessions.invalidateSessionCacheByReceiver(uuid);
      await this.db.session.updateMany({
        where: { receiveId: uuid, deletedAt: null },
        data: { deletedAt: now },
      });
      await this.db.userContact.updateMany({
        where: { contactId: uuid, deletedAt: null },
        data: { deletedAt: now },
      });
      await this.db.contactApply.updateMany({
        where: { contactId: uuid, deletedAt: null },
        data: { deletedAt: now },
      });
    }
    return ["groups deleted", 0];
  }

  async setGroupsStatus(uuidList: string[], status: number): Promise<[string, number]> {
    await this.db.groupInfo.updateMany({
      where: { uuid: { in: uuidList } },
      data: { status, updatedAt: new Date() },
    });
    if (status === GroupStatusDisable) {
      const now = new Date();
      for (const uuid of uuidList) {
        await this.sessions.invalidateSessionCacheByReceiver(uuid);
        await this.db.session.updateMany({
          where: { receiveId: uuid, deletedAt: null },
          data: { deletedAt: now },
        });
      }
    }
    return ["group status updated", 0];
  }
}
