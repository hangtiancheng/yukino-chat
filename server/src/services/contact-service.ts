import type { CacheService } from "../cache/cache-service.js";
import { isYukino, newApply, newTag } from "../common/ids.js";
import type { PrismaDB } from "../database/prisma.js";
import type { ContactApply } from "../generated/prisma/client.js";
import type { ChatHub } from "../hub/chat-hub.js";
import {
  ApplyStatusApplying,
  ApplyStatusBlack,
  ApplyStatusPass,
  ApplyStatusRefuse,
  ContactBeBlack,
  ContactBeDelete,
  ContactBlack,
  ContactDelete,
  ContactNormal,
  ContactTypeGroup,
  ContactTypeUser,
  GroupStatusDisable,
  NotifyApply,
  NotifyContact,
  NotifyGroup,
  NotifySession,
  UserStatusDisable,
} from "../hub/frame-types.js";
import type { SessionService } from "./session-service.js";

export interface ContactInfoResponse {
  contact_id: string;
  contact_name: string;
  contact_avatar: string;
  contact_phone: string;
  contact_email: string;
  contact_gender: number;
  contact_signature: string;
  contact_birthday: string;
  contact_notice: string;
  contact_members: string[];
  contact_member_cnt: number;
  contact_owner_id: string;
  contact_add_mode: number;
}

export interface ContactApplyResponse {
  apply_id: string;
  user_id: string;
  contact_id: string;
  contact_name: string;
  contact_type: number;
  status: number;
  message: string;
}

export interface ContactListItem {
  user_id: string;
  nickname: string;
  avatar: string;
  status: number;
  note_name: string;
  tag_id: string;
  online: boolean;
}

export interface TagItem {
  tag_id: string;
  name: string;
}

export class ContactService {
  constructor(
    private readonly db: PrismaDB,
    private readonly cache: CacheService,
    readonly _sessions: SessionService,
    private readonly hub: ChatHub,
  ) {}

  async getTagList(ownerId: string): Promise<[string, TagItem[] | null, number]> {
    const tags = await this.db.contactTag.findMany({
      where: { userId: ownerId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return ["success", tags.map((t) => ({ tag_id: t.uuid, name: t.name })), 0];
  }

  async addTag(ownerId: string, name: string): Promise<[string, TagItem | null, number]> {
    name = name.trim();
    if (name === "") return ["tag name is required", null, -2];
    const existing = await this.db.contactTag.findFirst({
      where: { userId: ownerId, name, deletedAt: null },
    });
    if (existing) return ["tag already exists", null, -2];
    const tag = await this.db.contactTag.create({
      data: { uuid: newTag(), userId: ownerId, name },
    });
    return ["tag created", { tag_id: tag.uuid, name: tag.name }, 0];
  }

  async updateContact(
    userId: string,
    contactId: string,
    noteName: string | null,
    tagId: string | null,
  ): Promise<[string, number]> {
    const data: { noteName?: string; tagId?: string; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (noteName !== null) data.noteName = noteName;
    if (tagId !== null) data.tagId = tagId;
    if (noteName === null && tagId === null) return ["nothing to update", -2];
    await this.db.userContact.updateMany({
      where: { userId, contactId, deletedAt: null },
      data,
    });
    return ["contact updated", 0];
  }

  // Blocked contacts are included (with their status) so the client can offer
  // an unblock action.
  async getUserList(ownerId: string): Promise<[string, ContactListItem[] | null, number]> {
    const contacts = await this.db.userContact.findMany({
      where: {
        userId: ownerId,
        contactType: ContactTypeUser,
        status: { in: [ContactNormal, ContactBlack, ContactBeBlack] },
        deletedAt: null,
      },
    });
    const ids = contacts.map((c) => c.contactId);
    if (ids.length === 0) return ["success", null, 0];
    const users = await this.db.userInfo.findMany({
      where: { uuid: { in: ids }, deletedAt: null },
    });
    const contactById = new Map(contacts.map((c) => [c.contactId, c]));
    const list: ContactListItem[] = [];
    for (const user of users) {
      const c = contactById.get(user.uuid);
      if (!c) continue;
      list.push({
        user_id: user.uuid,
        nickname: user.nickname,
        avatar: user.avatar,
        status: c.status,
        note_name: c.noteName,
        tag_id: c.tagId,
        online: this.hub.isOnline(user.uuid),
      });
    }
    return ["success", list, 0];
  }

  async loadMyJoinedGroup(ownerId: string): Promise<[string, unknown[] | null, number]> {
    const contacts = await this.db.userContact.findMany({
      where: {
        userId: ownerId,
        contactType: ContactTypeGroup,
        status: ContactNormal,
        deletedAt: null,
      },
    });
    const ids = contacts.map((c) => c.contactId);
    if (ids.length === 0) return ["success", null, 0];
    const groups = await this.db.groupInfo.findMany({
      where: { uuid: { in: ids }, deletedAt: null },
    });
    const list = groups
      .filter((g) => g.ownerId !== ownerId)
      .map((g) => ({
        group_id: g.uuid,
        name: g.name,
        member_cnt: g.memberCnt,
        owner_id: g.ownerId,
        avatar: g.avatar,
      }));
    return ["success", list, 0];
  }

  // Phone and email are PII: only the account owner sees them in full.
  async getContactInfo(
    userId: string,
    contactId: string,
  ): Promise<[string, ContactInfoResponse | null, number]> {
    if (contactId.startsWith("G")) {
      const group = await this.db.groupInfo.findFirst({
        where: { uuid: contactId, deletedAt: null },
      });
      if (!group) return ["Internal Server Error", null, -1];
      return [
        "success",
        {
          contact_id: group.uuid,
          contact_name: group.name,
          contact_avatar: group.avatar,
          contact_phone: "",
          contact_email: "",
          contact_gender: 0,
          contact_signature: "",
          contact_birthday: "",
          contact_notice: group.notice,
          contact_members: group.members,
          contact_member_cnt: group.memberCnt,
          contact_owner_id: group.ownerId,
          contact_add_mode: group.addMode,
        },
        0,
      ];
    }
    const user = await this.db.userInfo.findFirst({
      where: { uuid: contactId, deletedAt: null },
    });
    if (!user) return ["Internal Server Error", null, -1];
    let phone = user.telephone;
    let email = user.email;
    if (userId !== user.uuid) {
      phone = maskPhone(phone);
      email = maskEmail(email);
    }
    return [
      "success",
      {
        contact_id: user.uuid,
        contact_name: user.nickname,
        contact_avatar: user.avatar,
        contact_phone: phone,
        contact_email: email,
        contact_gender: user.gender,
        contact_signature: user.signature,
        contact_birthday: user.birthday,
        contact_notice: "",
        contact_members: [],
        contact_member_cnt: 0,
        contact_owner_id: "",
        contact_add_mode: 0,
      },
      0,
    ];
  }

  async applyContact(
    userId: string,
    contactId: string,
    contactType: number,
    message: string,
  ): Promise<[string, number]> {
    if (isYukino(contactId)) {
      return ["the Yukino assistant cannot be applied", -2];
    }
    // Validate the target and refuse disabled targets.
    if (contactType === ContactTypeUser) {
      const target = await this.db.userInfo.findFirst({
        where: { uuid: contactId, deletedAt: null },
      });
      if (!target) return ["user not found", -2];
      if (target.status === UserStatusDisable) return ["user is disabled", -2];
    } else {
      const target = await this.db.groupInfo.findFirst({
        where: { uuid: contactId, deletedAt: null },
      });
      if (!target) return ["group not found", -2];
      if (target.status === GroupStatusDisable) return ["group is disabled", -2];
    }

    // Re-applying updates the existing record instead of inserting a new one;
    // a blacklisted apply blocks any further attempts.
    const existing = await this.db.contactApply.findFirst({
      where: { userId, contactId, deletedAt: null },
    });
    if (existing) {
      if (existing.status === ApplyStatusBlack) {
        return ["you have been blocked by the recipient", -2];
      }
      await this.db.contactApply.update({
        where: { uuid: existing.uuid },
        data: {
          status: ApplyStatusApplying,
          message,
          lastApplyAt: new Date(),
        },
      });
      await this.notifyApplyRecipient(contactId, contactType);
      return ["application submitted", 0];
    }

    await this.db.contactApply.create({
      data: {
        uuid: newApply(),
        userId,
        contactId,
        contactType,
        status: ApplyStatusApplying,
        message,
        lastApplyAt: new Date(),
      },
    });
    await this.notifyApplyRecipient(contactId, contactType);
    return ["application submitted", 0];
  }

  // Pushes an apply notification to whoever reviews it: the target user for
  // friend applies, the group owner for join applies.
  private async notifyApplyRecipient(contactId: string, contactType: number) {
    if (contactType === ContactTypeUser) {
      this.hub.pushSystem(NotifyApply, [contactId]);
      return;
    }
    const group = await this.db.groupInfo.findFirst({
      where: { uuid: contactId, deletedAt: null },
    });
    if (group) this.hub.pushSystem(NotifyApply, [group.ownerId]);
  }

  // Pending friend applications addressed to the user.
  async getNewContactList(
    userId: string,
  ): Promise<[string, ContactApplyResponse[] | null, number]> {
    const applies = await this.db.contactApply.findMany({
      where: {
        contactId: userId,
        contactType: ContactTypeUser,
        status: ApplyStatusApplying,
        deletedAt: null,
      },
      orderBy: { lastApplyAt: "desc" },
    });
    return ["success", await this.toApplyResponses(applies), 0];
  }

  private async toApplyResponses(applies: ContactApply[]): Promise<ContactApplyResponse[]> {
    const ids = applies.map((a) => a.userId);
    const users = ids.length
      ? await this.db.userInfo.findMany({
          where: { uuid: { in: ids }, deletedAt: null },
        })
      : [];
    const names = new Map(users.map((u) => [u.uuid, u.nickname]));
    return applies.map((a) => ({
      apply_id: a.uuid,
      user_id: a.userId,
      contact_id: a.contactId,
      contact_name: names.get(a.userId) ?? a.userId,
      contact_type: a.contactType,
      status: a.status,
      message: a.message,
    }));
  }

  private async canHandleApply(apply: ContactApply, userId: string): Promise<boolean> {
    if (apply.contactType === ContactTypeGroup) {
      const group = await this.db.groupInfo.findFirst({
        where: { uuid: apply.contactId, deletedAt: null },
      });
      return group?.ownerId === userId;
    }
    return apply.contactId === userId;
  }

  // Approves an application. Friend applications create the two-way contact
  // pair; group applications add the applicant to the group.
  async passContactApply(userId: string, applyId: string): Promise<[string, number]> {
    const apply = await this.db.contactApply.findFirst({
      where: { uuid: applyId, deletedAt: null },
    });
    if (!apply) return ["Internal Server Error", -1];
    if (apply.status !== ApplyStatusApplying) {
      return ["application already handled", -2];
    }
    if (!(await this.canHandleApply(apply, userId))) {
      return ["this application is not addressed to you", -2];
    }

    await this.db.$transaction(async (tx) => {
      await tx.contactApply.update({
        where: { uuid: applyId },
        data: { status: ApplyStatusPass },
      });
      if (apply.contactType === ContactTypeGroup) {
        const group = await tx.groupInfo.findFirst({
          where: { uuid: apply.contactId, deletedAt: null },
        });
        if (!group) throw new Error("group not found");
        await addGroupMember(tx, apply.contactId, apply.userId);
        await ensureGroupContact(tx, apply.userId, apply.contactId);
        return;
      }
      await ensureUserContact(tx, apply.userId, apply.contactId);
      await ensureUserContact(tx, apply.contactId, apply.userId);
    });
    if (apply.contactType === ContactTypeGroup) {
      this.hub.pushSystem(NotifyGroup, [apply.userId]);
      this.hub.pushSystem(NotifySession, [apply.userId]);
    } else {
      this.hub.pushSystem(NotifyContact, [apply.userId, apply.contactId]);
    }
    return ["application approved", 0];
  }

  async blackContact(userId: string, contactId: string): Promise<[string, number]> {
    if (isYukino(contactId)) {
      return ["the Yukino assistant cannot be blocked", -2];
    }
    const now = new Date();
    await this.db.userContact.updateMany({
      where: { userId, contactId },
      data: { status: ContactBlack, updatedAt: now },
    });
    await this.db.userContact.updateMany({
      where: { userId: contactId, contactId: userId },
      data: { status: ContactBeBlack, updatedAt: now },
    });
    // The blocker's session goes away, matching the old behavior.
    await this.db.session.updateMany({
      where: { sendId: userId, receiveId: contactId, deletedAt: null },
      data: { deletedAt: now },
    });
    await this.cache.deleteSessionList(userId);
    this.hub.pushSystem(NotifyContact, [contactId]);
    return ["contact blocked", 0];
  }

  async cancelBlackContact(userId: string, contactId: string): Promise<[string, number]> {
    const now = new Date();
    await this.db.userContact.updateMany({
      where: { userId, contactId },
      data: { status: ContactNormal, updatedAt: now },
    });
    await this.db.userContact.updateMany({
      where: { userId: contactId, contactId: userId },
      data: { status: ContactNormal, updatedAt: now },
    });
    this.hub.pushSystem(NotifyContact, [contactId]);
    return ["contact unblocked", 0];
  }

  async deleteContact(userId: string, contactId: string): Promise<[string, number]> {
    if (isYukino(contactId)) {
      return ["the Yukino assistant cannot be removed", -2];
    }
    await this.db.$transaction(async (tx) => {
      const now = new Date();
      await tx.userContact.updateMany({
        where: { userId, contactId, deletedAt: null },
        data: { status: ContactDelete, deletedAt: now },
      });
      await tx.userContact.updateMany({
        where: { userId: contactId, contactId: userId, deletedAt: null },
        data: { status: ContactBeDelete, deletedAt: now },
      });
      // Both directions of the session and the historical applies go away, so
      // a future application starts from a clean slate.
      await tx.session.updateMany({
        where: { sendId: userId, receiveId: contactId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.session.updateMany({
        where: { sendId: contactId, receiveId: userId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.contactApply.updateMany({
        where: { userId, contactId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.contactApply.updateMany({
        where: { userId: contactId, contactId: userId, deletedAt: null },
        data: { deletedAt: now },
      });
    });
    await this.cache.deleteSessionList(userId);
    await this.cache.deleteSessionList(contactId);
    this.hub.pushSystem(NotifyContact, [contactId]);
    this.hub.pushSystem(NotifySession, [contactId]);
    return ["deleted", 0];
  }

  async refuseContactApply(userId: string, applyId: string): Promise<[string, number]> {
    const apply = await this.db.contactApply.findFirst({
      where: { uuid: applyId, deletedAt: null },
    });
    if (!apply) return ["Internal Server Error", -1];
    if (!(await this.canHandleApply(apply, userId))) {
      return ["this application is not addressed to you", -2];
    }
    await this.db.contactApply.update({
      where: { uuid: applyId },
      data: { status: ApplyStatusRefuse },
    });
    return ["application refused", 0];
  }

  async blackApply(userId: string, applyId: string): Promise<[string, number]> {
    const apply = await this.db.contactApply.findFirst({
      where: { uuid: applyId, deletedAt: null },
    });
    if (!apply) return ["Internal Server Error", -1];
    if (!(await this.canHandleApply(apply, userId))) {
      return ["this application is not addressed to you", -2];
    }
    await this.db.contactApply.update({
      where: { uuid: applyId },
      data: { status: ApplyStatusBlack },
    });
    return ["application blocked", 0];
  }

  // Pending join applications for every group the caller owns.
  async getAddGroupList(ownerId: string): Promise<[string, ContactApplyResponse[] | null, number]> {
    const groups = await this.db.groupInfo.findMany({
      where: { ownerId, deletedAt: null },
    });
    const groupIds = groups.map((g) => g.uuid);
    if (groupIds.length === 0) return ["success", null, 0];
    const applies = await this.db.contactApply.findMany({
      where: {
        contactId: { in: groupIds },
        contactType: ContactTypeGroup,
        status: ApplyStatusApplying,
        deletedAt: null,
      },
      orderBy: { lastApplyAt: "desc" },
    });
    return ["success", await this.toApplyResponses(applies), 0];
  }

  // Soft-deletes the member's session, contact record (stamped with the given
  // status) and pending applies for the group. Shared with group-service.
  async cleanupGroupMembership(userId: string, groupId: string, contactStatus: number) {
    const now = new Date();
    await this.db.userContact.updateMany({
      where: { userId, contactId: groupId, deletedAt: null },
      data: { status: contactStatus, deletedAt: now },
    });
    await this.db.session.updateMany({
      where: { sendId: userId, receiveId: groupId, deletedAt: null },
      data: { deletedAt: now },
    });
    await this.db.contactApply.updateMany({
      where: { userId, contactId: groupId, deletedAt: null },
      data: { deletedAt: now },
    });
    await this.cache.deleteSessionList(userId);
  }
}

// Keeps the first 3 and last 4 digits, e.g. 138****1234.
function maskPhone(phone: string): string {
  if (phone.length < 7) return "*".repeat(phone.length);
  return phone.slice(0, 3) + "*".repeat(phone.length - 7) + phone.slice(-4);
}

// Keeps the first character of the local part and the domain.
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 1) return email;
  return email.slice(0, 1) + "*".repeat(at - 1) + email.slice(at);
}

// Prisma transaction clients share the model API surface of PrismaDB for the
// models used here.
type Tx = Parameters<Parameters<PrismaDB["$transaction"]>[0]>[0];

// Inserts a user↔user contact, restoring a soft-deleted record if one exists.
export async function ensureUserContact(db: PrismaDB | Tx, userId: string, contactId: string) {
  const now = new Date();
  const existing = await db.userContact.findFirst({ where: { userId, contactId } });
  if (existing) {
    await db.userContact.updateMany({
      where: { userId, contactId },
      data: { status: ContactNormal, updatedAt: now, deletedAt: null },
    });
    return;
  }
  await db.userContact.create({
    data: {
      userId,
      contactId,
      contactType: ContactTypeUser,
      status: ContactNormal,
      createdAt: now,
      updatedAt: now,
    },
  });
}

// Inserts the user→group contact, restoring a previously soft-deleted record.
export async function ensureGroupContact(db: PrismaDB | Tx, userId: string, groupId: string) {
  const now = new Date();
  const existing = await db.userContact.findFirst({ where: { userId, contactId: groupId } });
  if (existing) {
    await db.userContact.updateMany({
      where: { userId, contactId: groupId },
      data: { status: ContactNormal, updatedAt: now, deletedAt: null },
    });
    return;
  }
  await db.userContact.create({
    data: {
      userId,
      contactId: groupId,
      contactType: ContactTypeGroup,
      status: ContactNormal,
      createdAt: now,
      updatedAt: now,
    },
  });
}

// Appends the user to the members array and bumps member_cnt when the set
// actually grew.
export async function addGroupMember(
  db: PrismaDB | Tx,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const group = await db.groupInfo.findFirst({
    where: { uuid: groupId },
    select: { members: true },
  });
  if (!group) return false;
  if (group.members.includes(userId)) return false;
  await db.groupInfo.update({
    where: { uuid: groupId },
    data: {
      members: { push: userId },
      memberCnt: { increment: 1 },
      updatedAt: new Date(),
    },
  });
  return true;
}

// Removes the user from the members array and drops member_cnt when the
// member was actually present.
export async function removeGroupMember(
  db: PrismaDB | Tx,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const group = await db.groupInfo.findFirst({
    where: { uuid: groupId },
    select: { members: true },
  });
  if (!group) return false;
  if (!group.members.includes(userId)) return false;
  await db.groupInfo.update({
    where: { uuid: groupId },
    data: {
      members: group.members.filter((m) => m !== userId),
      memberCnt: { decrement: 1 },
      updatedAt: new Date(),
    },
  });
  return true;
}
