import type { WebSocket } from "ws";
import { fmtDateTime, nowDate } from "../common/time.js";
import type { PrismaDB } from "../database/prisma.js";
import type { CallManager } from "./call-manager.js";
import {
  MessageAudioOrVideo,
  type MessageListItem,
  MessageSystem,
  NotifyOnline,
  WELCOME_TEXT,
} from "./frame-types.js";

export interface ClientConn {
  uuid: string;
  ws: WebSocket;
  alive: boolean;
  lastSeen: number;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
// Three missed heartbeats mark the connection dead.
const READ_IDLE_TIMEOUT_MS = 90_000;

export class ChatHub {
  private clients = new Map<string, ClientConn>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: PrismaDB,
    readonly calls: CallManager,
  ) {}

  start() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => this.sweepHeartbeats(), HEARTBEAT_INTERVAL_MS);
  }

  stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const conn of this.clients.values()) {
      this.safeClose(conn);
    }
    this.clients.clear();
  }

  private sweepHeartbeats() {
    const now = Date.now();
    for (const conn of this.clients.values()) {
      if (now - conn.lastSeen > READ_IDLE_TIMEOUT_MS) {
        this.unregister(conn);
        continue;
      }
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }

  register(conn: ClientConn) {
    const old = this.clients.get(conn.uuid);
    this.clients.set(conn.uuid, conn);
    if (old) {
      this.safeClose(old);
    }
    this.writeText(conn, WELCOME_TEXT);
    if (!old) {
      // Presence changed: contacts refresh their online indicators.
      this.broadcastSystem(NotifyOnline, conn.uuid);
      this.db.userInfo
        .update({ where: { uuid: conn.uuid }, data: { lastOnlineAt: nowDate() } })
        .catch(() => {});
    }
  }

  unregister(conn: ClientConn) {
    const removed = this.clients.get(conn.uuid) === conn;
    if (removed) {
      this.clients.delete(conn.uuid);
    }
    this.safeClose(conn);
    if (!removed) return;

    // Drop out of any active call so peers close the dead streams.
    const [roomId, remaining] = this.calls.leave(conn.uuid);
    if (roomId !== "" && remaining.length > 0) {
      const item: MessageListItem = {
        uuid: "",
        send_id: conn.uuid,
        send_name: "",
        send_avatar: "",
        receive_id: roomId,
        type: MessageAudioOrVideo,
        content: "",
        url: "",
        file_size: "",
        file_name: "",
        file_type: "",
        created_at: fmtDateTime(nowDate()),
        av_data: JSON.stringify({
          messageId: "PROXY",
          type: "leave_call",
          room_id: roomId,
        }),
      };
      this.sendRaw(JSON.stringify(item), remaining);
    }
    this.broadcastSystem(NotifyOnline, conn.uuid);
    this.db.userInfo
      .update({ where: { uuid: conn.uuid }, data: { lastOfflineAt: nowDate() } })
      .catch(() => {});
  }

  // Forces a client's socket closed and removes it (used by ws-logout).
  logout(uuid: string): boolean {
    const conn = this.clients.get(uuid);
    if (!conn) return false;
    this.unregister(conn);
    return true;
  }

  writeText(conn: ClientConn, text: string) {
    if (conn.ws.readyState === conn.ws.OPEN) {
      conn.ws.send(text);
    }
  }

  // Delivers a payload to the given clients. Sends are best-effort.
  sendRaw(payload: string, targets: string[]) {
    for (const id of targets) {
      const conn = this.clients.get(id);
      if (conn && conn.ws.readyState === conn.ws.OPEN) {
        conn.ws.send(payload);
      }
    }
  }

  // Writes a raw text frame to one client (e.g. the overflow rejection).
  sendTextTo(uuid: string, text: string) {
    const conn = this.clients.get(uuid);
    if (conn) this.writeText(conn, text);
  }

  // System notification frame ({type:5, send_id:"SYSTEM", content:topic}).
  pushSystem(topic: string, uuids: string[]) {
    if (uuids.length === 0) return;
    const item: MessageListItem = {
      uuid: "",
      send_id: "SYSTEM",
      send_name: "",
      send_avatar: "",
      receive_id: "",
      type: MessageSystem,
      content: topic,
      url: "",
      file_size: "",
      file_name: "",
      file_type: "",
      created_at: fmtDateTime(nowDate()),
    };
    this.sendRaw(JSON.stringify(item), uuids);
  }

  // Sends a system notification to every online user except the excluded one.
  broadcastSystem(topic: string, exclude: string) {
    this.pushSystem(
      topic,
      [...this.clients.keys()].filter((uuid) => uuid !== exclude),
    );
  }

  getOnlineUserList(): string[] {
    return [...this.clients.keys()];
  }

  isOnline(uuid: string): boolean {
    return this.clients.has(uuid);
  }

  private safeClose(conn: ClientConn) {
    try {
      conn.ws.close(1000);
    } catch {
      try {
        conn.ws.terminate();
      } catch {
        // Already gone.
      }
    }
  }
}
