import { Redis } from "ioredis";
import { env } from "../config/env.js";

// Read-through cache mirroring the Go server's two groupcache groups
// (user_info by uuid, session_list by owner uuid). Redis-backed in production,
// in-memory in tests (REDIS_URL=""). Every method degrades to a miss on Redis
// errors instead of rejecting — the DB remains the source of truth.

export type CacheGroup = "user_info" | "session_list";

// Shape cached under the user_info group — mirrors Go's model.UserInfo JSON
// projection (password and deleted_at excluded).
export interface CachedUser {
  uuid: string;
  nickname: string;
  telephone: string;
  email: string;
  avatar: string;
  gender: number;
  signature: string;
  birthday: string;
  created_at: string;
  last_online_at: string | null;
  last_offline_at: string | null;
  is_admin: number;
  status: number;
}

const PREFIX = "yukino:cache";
const keyFor = (group: CacheGroup, key: string) => `${PREFIX}:${group}:${key}`;
const idxKey = (group: CacheGroup) => `${PREFIX}:idx:${group}`;
const metaKey = (group: CacheGroup) => `${PREFIX}:meta:${group}`;

interface MetaEntry {
  size: number;
  expire_at: number;
}

interface CacheStore {
  get(group: CacheGroup, key: string): Promise<string | null>;
  set(group: CacheGroup, key: string, value: string): Promise<void>;
  delete(group: CacheGroup, key: string): Promise<void>;
  entries(group: CacheGroup): Promise<Map<string, MetaEntry>>;
  close(): Promise<void>;
}

class RedisStore implements CacheStore {
  private redis: InstanceType<typeof Redis>;

  constructor(url: string) {
    this.redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.redis.on("error", () => {});
    this.redis.connect().catch(() => {});
  }

  async get(group: CacheGroup, key: string) {
    try {
      return await this.redis.get(keyFor(group, key));
    } catch {
      return null;
    }
  }

  async set(group: CacheGroup, key: string, value: string) {
    const ttl = env.CACHE_TTL_SECONDS;
    try {
      await this.redis.set(keyFor(group, key), value, "EX", ttl);
      await this.redis.sadd(idxKey(group), key);
      const meta: MetaEntry = {
        size: Buffer.byteLength(value, "utf8"),
        expire_at: Math.floor(Date.now() / 1000) + ttl,
      };
      await this.redis.hset(metaKey(group), key, JSON.stringify(meta));
    } catch {
      // Cache writes are best-effort.
    }
  }

  async delete(group: CacheGroup, key: string) {
    try {
      await this.redis.del(keyFor(group, key));
      await this.redis.srem(idxKey(group), key);
      await this.redis.hdel(metaKey(group), key);
    } catch {
      // Ignore.
    }
  }

  async entries(group: CacheGroup) {
    const out = new Map<string, MetaEntry>();
    try {
      const keys = await this.redis.smembers(idxKey(group));
      if (keys.length === 0) return out;
      const raw = await this.redis.hmget(metaKey(group), ...keys);
      keys.forEach((k: string, i: number) => {
        const v = raw[i];
        if (v === null) return;
        try {
          out.set(k, JSON.parse(v) as MetaEntry);
        } catch {
          // Skip malformed entries.
        }
      });
    } catch {
      // Empty snapshot on Redis failure.
    }
    return out;
  }

  async close() {
    this.redis.disconnect();
  }
}

class MemoryStore implements CacheStore {
  private data = new Map<string, { value: string; expireAt: number }>();
  private meta = new Map<CacheGroup, Map<string, MetaEntry>>();

  private groupMeta(group: CacheGroup) {
    let m = this.meta.get(group);
    if (!m) {
      m = new Map();
      this.meta.set(group, m);
    }
    return m;
  }

  async get(group: CacheGroup, key: string) {
    const entry = this.data.get(keyFor(group, key));
    if (!entry) return null;
    if (Date.now() > entry.expireAt) {
      this.data.delete(keyFor(group, key));
      return null;
    }
    return entry.value;
  }

  async set(group: CacheGroup, key: string, value: string) {
    const ttlMs = env.CACHE_TTL_SECONDS * 1000;
    this.data.set(keyFor(group, key), {
      value,
      expireAt: Date.now() + ttlMs,
    });
    this.groupMeta(group).set(key, {
      size: Buffer.byteLength(value, "utf8"),
      expire_at: Math.floor(Date.now() / 1000) + env.CACHE_TTL_SECONDS,
    });
  }

  async delete(group: CacheGroup, key: string) {
    this.data.delete(keyFor(group, key));
    this.groupMeta(group).delete(key);
  }

  async entries(group: CacheGroup) {
    return new Map(this.groupMeta(group));
  }

  async close() {}
}

export class CacheService {
  private store: CacheStore;

  constructor() {
    this.store = env.REDIS_URL ? new RedisStore(env.REDIS_URL) : new MemoryStore();
  }

  // ---- user_info group ----

  async getUser<T>(uuid: string): Promise<T | null> {
    const raw = await this.store.get("user_info", uuid);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setUser(uuid: string, value: unknown) {
    await this.store.set("user_info", uuid, JSON.stringify(value));
  }

  async deleteUser(uuid: string) {
    await this.store.delete("user_info", uuid);
  }

  // ---- session_list group ----

  async getSessionList<T>(owner: string): Promise<T | null> {
    const raw = await this.store.get("session_list", owner);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setSessionList(owner: string, value: unknown) {
    await this.store.set("session_list", owner, JSON.stringify(value));
  }

  async deleteSessionList(owner: string) {
    await this.store.delete("session_list", owner);
  }

  // ---- dashboard ----

  async snapshot() {
    const groups: {
      name: CacheGroup;
      stats: Record<string, number>;
      entries: { key: string; size: number; expire_at: number; level: number }[];
    }[] = [];
    for (const group of ["user_info", "session_list"] as CacheGroup[]) {
      const entries = await this.store.entries(group);
      const list = [...entries.entries()].map(([key, m]) => ({
        key,
        size: m.size,
        expire_at: m.expire_at,
        level: 1,
      }));
      groups.push({
        name: group,
        stats: {
          keys: list.length,
          bytes: list.reduce((sum, e) => sum + e.size, 0),
        },
        entries: list,
      });
    }
    return { type: "snapshot", groups };
  }

  async deleteKey(group: string, key: string) {
    if (group === "user_info" || group === "session_list") {
      await this.store.delete(group, key);
    }
  }

  async close() {
    await this.store.close();
  }
}
