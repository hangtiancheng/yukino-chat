import type { CachedUser, CacheService } from "../cache/cache-service.js";
import {
  isYukino,
  newTag,
  newUser,
  YUKINO_NAME,
  YUKINO_SIGNATURE,
  YUKINO_UUID,
} from "../common/ids.js";
import { hashPassword, PasswordTooLongError, verifyPassword } from "../common/password.js";
import { fmtYMD } from "../common/time.js";
import type { PrismaDB } from "../database/prisma.js";
import {
  ContactBeBlack,
  ContactBlack,
  ContactNormal,
  ContactTypeUser,
  UserStatusDisable,
  UserStatusNormal,
} from "../hub/frame-types.js";
import type { SessionService } from "./session-service.js";

export interface UserInfoResponse {
  uuid: string;
  telephone: string;
  nickname: string;
  email: string;
  avatar: string;
  gender: number;
  birthday: string;
  signature: string;
  is_admin: number;
  status: number;
  created_at: string;
}

export interface UserListItem {
  uuid: string;
  telephone: string;
  nickname: string;
  status: number;
  is_admin: number;
  is_deleted: boolean;
}

export interface AuthResponse {
  token: string;
  user_info: UserInfoResponse;
}

export interface SearchUserItem {
  uuid: string;
  nickname: string;
  telephone: string;
  avatar: string;
  is_friend: boolean;
}

interface UserRow {
  uuid: string;
  telephone: string;
  nickname: string;
  email: string;
  avatar: string;
  gender: number;
  signature: string;
  birthday: string;
  isAdmin: number;
  status: number;
  createdAt: Date;
}

const toUserInfoResponse = (u: UserRow): UserInfoResponse => ({
  uuid: u.uuid,
  telephone: u.telephone,
  nickname: u.nickname,
  email: u.email,
  avatar: u.avatar,
  gender: u.gender,
  birthday: u.birthday,
  signature: u.signature,
  is_admin: u.isAdmin,
  status: u.status,
  created_at: fmtYMD(u.createdAt),
});

const cachedFromRow = (u: UserRow): CachedUser => ({
  uuid: u.uuid,
  nickname: u.nickname,
  telephone: u.telephone,
  email: u.email,
  avatar: u.avatar,
  gender: u.gender,
  signature: u.signature,
  birthday: u.birthday,
  created_at: u.createdAt.toISOString(),
  last_online_at: null,
  last_offline_at: null,
  is_admin: u.isAdmin,
  status: u.status,
});

const rowFromCached = (c: CachedUser): UserRow => ({
  uuid: c.uuid,
  telephone: c.telephone,
  nickname: c.nickname,
  email: c.email,
  avatar: c.avatar,
  gender: c.gender,
  signature: c.signature,
  birthday: c.birthday,
  isAdmin: c.is_admin,
  status: c.status,
  createdAt: new Date(c.created_at),
});

export class UserService {
  constructor(
    private readonly db: PrismaDB,
    private readonly cache: CacheService,
    private readonly sessions: SessionService,
    private readonly issueToken: (uuid: string) => string,
  ) {}

  // Creates the reserved Yukino assistant account on startup.
  async ensureYukinoUser() {
    const existing = await this.db.userInfo.findFirst({
      where: { uuid: YUKINO_UUID },
    });
    if (existing) return;
    await this.db.userInfo.create({
      data: {
        uuid: YUKINO_UUID,
        telephone: "",
        nickname: YUKINO_NAME,
        signature: YUKINO_SIGNATURE,
        status: UserStatusNormal,
      },
    });
  }

  private async ensureUserContact(userId: string, contactId: string) {
    const now = new Date();
    const existing = await this.db.userContact.findFirst({
      where: { userId, contactId },
    });
    if (existing) {
      await this.db.userContact.updateMany({
        where: { userId, contactId },
        data: { status: ContactNormal, updatedAt: now, deletedAt: null },
      });
      return;
    }
    await this.db.userContact.create({
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

  // Idempotently gives a user the undeletable Yukino contact and a session
  // pointing at it. Called on register and login.
  async ensureYukinoContact(userId: string) {
    if (userId === "" || isYukino(userId)) return;
    await this.ensureUserContact(userId, YUKINO_UUID);
    await this.ensureUserContact(YUKINO_UUID, userId);
    await this.sessions.ensurePeerSession(userId, YUKINO_UUID);
  }

  async login(telephone: string, password: string): Promise<[string, AuthResponse | null, number]> {
    const user = await this.db.userInfo.findFirst({
      where: { telephone, deletedAt: null },
    });
    if (!user) return ["user not found, please register", null, -2];
    if (!(await verifyPassword(user.password, password))) {
      return ["incorrect password", null, -2];
    }
    if (user.status === UserStatusDisable) {
      return ["account is disabled", null, -2];
    }
    await this.ensureYukinoContact(user.uuid);
    return [
      "login successful",
      { token: this.issueToken(user.uuid), user_info: toUserInfoResponse(user) },
      0,
    ];
  }

  async register(
    telephone: string,
    password: string,
    nickname: string,
  ): Promise<[string, AuthResponse | null, number]> {
    const existing = await this.db.userInfo.findFirst({
      where: { telephone, deletedAt: null },
    });
    if (existing) return ["phone number already registered", null, -2];

    let hash: string;
    try {
      hash = await hashPassword(password);
    } catch (err) {
      if (err instanceof PasswordTooLongError) {
        return ["password must be at most 72 bytes", null, -2];
      }
      throw err;
    }

    const user = await this.db.userInfo.create({
      data: {
        uuid: newUser(),
        telephone,
        password: hash,
        nickname,
        avatar: "",
        isAdmin: 0,
        status: UserStatusNormal,
      },
    });
    // Every account starts with a default contact tag.
    await this.db.contactTag
      .create({ data: { uuid: newTag(), userId: user.uuid, name: "Friends" } })
      .catch(() => {});
    await this.ensureYukinoContact(user.uuid);
    return [
      "registration successful",
      { token: this.issueToken(user.uuid), user_info: toUserInfoResponse(user) },
      0,
    ];
  }

  // Resets the password by telephone; deliberately unauthenticated like the
  // legacy forgot-password flow.
  async updatePassword(telephone: string, password: string): Promise<[string, number]> {
    const user = await this.db.userInfo.findFirst({
      where: { telephone, deletedAt: null },
    });
    if (!user) return ["user not found", -2];
    let hash: string;
    try {
      hash = await hashPassword(password);
    } catch (err) {
      if (err instanceof PasswordTooLongError) {
        return ["password must be at most 72 bytes", -2];
      }
      throw err;
    }
    await this.db.userInfo.update({
      where: { uuid: user.uuid },
      data: { password: hash },
    });
    await this.cache.deleteUser(user.uuid);
    return ["password updated", 0];
  }

  // Finds users by telephone or nickname keyword, flagging the ones that are
  // already contacts of the caller.
  async searchUsers(
    ownerId: string,
    keyword: string,
  ): Promise<[string, SearchUserItem[] | null, number]> {
    keyword = keyword.trim();
    if (keyword === "") return ["keyword is required", null, -2];
    const users = await this.db.userInfo.findMany({
      where: {
        deletedAt: null,
        uuid: { notIn: [ownerId, YUKINO_UUID] },
        status: UserStatusNormal,
        OR: [
          { telephone: { contains: keyword, mode: "insensitive" } },
          { nickname: { contains: keyword, mode: "insensitive" } },
        ],
      },
      take: 20,
    });
    if (users.length === 0) return ["success", null, 0];

    const ids = users.map((u) => u.uuid);
    const contacts = await this.db.userContact.findMany({
      where: {
        userId: ownerId,
        contactId: { in: ids },
        status: { in: [ContactNormal, ContactBlack, ContactBeBlack] },
        deletedAt: null,
      },
    });
    const friendSet = new Set(contacts.map((c) => c.contactId));
    return [
      "success",
      users.map((u) => ({
        uuid: u.uuid,
        nickname: u.nickname,
        telephone: u.telephone,
        avatar: u.avatar,
        is_friend: friendSet.has(u.uuid),
      })),
      0,
    ];
  }

  async updateUserInfo(
    uuid: string,
    fields: {
      nickname?: string;
      email?: string;
      birthday?: string;
      signature?: string;
      avatar?: string;
    },
  ): Promise<[string, number]> {
    if (Object.keys(fields).length === 0) return ["user info updated", 0];
    await this.db.userInfo.update({ where: { uuid }, data: fields });
    await this.cache.deleteUser(uuid);

    // Keep the denormalized session fields in sync with the user profile.
    const sessionFields: { receiveName?: string; avatar?: string } = {};
    if (fields.nickname !== undefined) sessionFields.receiveName = fields.nickname;
    if (fields.avatar !== undefined) sessionFields.avatar = fields.avatar;
    if (Object.keys(sessionFields).length > 0) {
      await this.db.session
        .updateMany({
          where: { receiveId: uuid, deletedAt: null },
          data: sessionFields,
        })
        .catch(() => {});
      await this.sessions.invalidateSessionCacheByReceiver(uuid);
    }
    return ["user info updated", 0];
  }

  async getUserInfo(uuid: string): Promise<[string, UserInfoResponse | null, number]> {
    const cached = await this.cache.getUser<CachedUser>(uuid);
    if (cached) return ["user info retrieved", toUserInfoResponse(rowFromCached(cached)), 0];
    const user = await this.db.userInfo.findFirst({
      where: { uuid, deletedAt: null },
    });
    if (!user) return ["Internal Server Error", null, -1];
    await this.cache.setUser(uuid, cachedFromRow(user));
    return ["user info retrieved", toUserInfoResponse(user), 0];
  }

  async getUserInfoList(ownerId: string): Promise<[string, UserListItem[] | null, number]> {
    const users = await this.db.userInfo.findMany({
      where: { uuid: { not: ownerId } },
    });
    return [
      "user list retrieved",
      users.map((u) => ({
        uuid: u.uuid,
        telephone: u.telephone,
        nickname: u.nickname,
        status: u.status,
        is_admin: u.isAdmin,
        is_deleted: u.deletedAt !== null,
      })),
      0,
    ];
  }

  async ableUsers(uuidList: string[]): Promise<[string, number]> {
    await this.db.userInfo.updateMany({
      where: { uuid: { in: uuidList } },
      data: { status: UserStatusNormal },
    });
    await this.invalidateUserCaches(uuidList);
    return ["users enabled", 0];
  }

  async disableUsers(uuidList: string[]): Promise<[string, number]> {
    uuidList = withoutYukino(uuidList);
    if (uuidList.length === 0) {
      return ["the Yukino assistant cannot be disabled", -2];
    }
    await this.db.userInfo.updateMany({
      where: { uuid: { in: uuidList } },
      data: { status: UserStatusDisable },
    });
    await this.invalidateUserCaches(uuidList);
    const now = new Date();
    for (const uuid of uuidList) {
      await this.sessions.invalidateSessionCacheByReceiver(uuid);
      await this.db.session.updateMany({
        where: { sendId: uuid, deletedAt: null },
        data: { deletedAt: now },
      });
      await this.db.session.updateMany({
        where: { receiveId: uuid, deletedAt: null },
        data: { deletedAt: now },
      });
    }
    return ["users disabled", 0];
  }

  async deleteUsers(uuidList: string[]): Promise<[string, number]> {
    uuidList = withoutYukino(uuidList);
    if (uuidList.length === 0) {
      return ["the Yukino assistant cannot be deleted", -2];
    }
    const now = new Date();
    await this.db.userInfo.updateMany({
      where: { uuid: { in: uuidList } },
      data: { deletedAt: now },
    });
    await this.invalidateUserCaches(uuidList);
    for (const uuid of uuidList) {
      await this.sessions.invalidateSessionCacheByReceiver(uuid);
      const cleanups = [
        { model: "session" as const, field: "sendId" as const },
        { model: "session" as const, field: "receiveId" as const },
        { model: "userContact" as const, field: "userId" as const },
        { model: "userContact" as const, field: "contactId" as const },
        { model: "contactApply" as const, field: "userId" as const },
        { model: "contactApply" as const, field: "contactId" as const },
      ];
      for (const c of cleanups) {
        await this.softDeleteBy(this.db, c.model, c.field, uuid, now);
      }
    }
    return ["users deleted", 0];
  }

  private async softDeleteBy(
    db: PrismaDB,
    model: "session" | "userContact" | "contactApply",
    field: "sendId" | "receiveId" | "userId" | "contactId",
    uuid: string,
    now: Date,
  ) {
    if (model === "session") {
      await db.session.updateMany({
        where: { [field]: uuid, deletedAt: null } as never,
        data: { deletedAt: now },
      });
    } else if (model === "userContact") {
      await db.userContact.updateMany({
        where: { [field]: uuid, deletedAt: null } as never,
        data: { deletedAt: now },
      });
    } else {
      await db.contactApply.updateMany({
        where: { [field]: uuid, deletedAt: null } as never,
        data: { deletedAt: now },
      });
    }
  }

  async setAdmin(uuidList: string[], isAdmin: number): Promise<[string, number]> {
    await this.db.userInfo.updateMany({
      where: { uuid: { in: uuidList } },
      data: { isAdmin },
    });
    await this.invalidateUserCaches(uuidList);
    return ["admin status updated", 0];
  }

  private async invalidateUserCaches(uuidList: string[]) {
    for (const uuid of uuidList) {
      await this.cache.deleteUser(uuid);
      await this.cache.deleteSessionList(uuid);
    }
  }
}

// Strips the reserved assistant account from admin batch operations so it can
// never be disabled or deleted.
function withoutYukino(uuidList: string[]): string[] {
  return uuidList.filter((uuid) => uuid !== YUKINO_UUID);
}
