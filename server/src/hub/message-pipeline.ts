import type { AgentManager } from "../agent/agent-manager.js";
import type { CachedUser, CacheService } from "../cache/cache-service.js";
import { isYukino, newMessage, YUKINO_UUID } from "../common/ids.js";
import { fmtDateTime, nowDate } from "../common/time.js";
import type { PrismaDB } from "../database/prisma.js";
import type { SessionService } from "../services/session-service.js";
import { CallManager } from "./call-manager.js";
import type { ChatHub } from "./chat-hub.js";
import {
  type AVSignal,
  type ChatFrame,
  MessageAudioOrVideo,
  type MessageListItem,
  MessageText,
  overflowFrame,
} from "./frame-types.js";

const CHANNEL_SIZE = 1024;

interface ResolvedSender {
  name: string;
  avatar: string;
}

export interface PipelineDeps {
  db: PrismaDB;
  cache: CacheService;
  hub: ChatHub;
  calls: CallManager;
  sessions: SessionService;
  agent: AgentManager | null;
}

export class MessagePipeline {
  // Serializes frame handling like the Go server's single event loop over the
  // Transmit channel; exceeding the channel cap rejects with the overflow
  // frame, mirroring the legacy behavior.
  private chain: Promise<void> = Promise.resolve();
  private depth = 0;

  constructor(private readonly deps: PipelineDeps) {}

  private get db() {
    return this.deps.db;
  }
  private get cache() {
    return this.deps.cache;
  }
  private get hub() {
    return this.deps.hub;
  }
  private get calls() {
    return this.deps.calls;
  }
  private get sessions() {
    return this.deps.sessions;
  }
  private get agent() {
    return this.deps.agent;
  }

  handleFrame(senderId: string, raw: string) {
    if (this.depth >= CHANNEL_SIZE) {
      this.hub.sendTextTo(senderId, overflowFrame);
      return;
    }
    this.depth++;
    const task = this.chain
      .then(() => this.handleMessage(senderId, raw))
      .catch((err) => {
        console.error(`handleMessage from ${senderId} failed:`, err);
      });
    this.chain = task.finally(() => {
      this.depth--;
    });
  }

  private async handleMessage(senderId: string, raw: string) {
    let req: ChatFrame;
    try {
      const parsed: unknown = JSON.parse(raw);
      req = coerceFrame(parsed);
    } catch {
      return;
    }

    // The sender is whoever owns this connection, never whoever the frame
    // claims: send_id drives persistence, routing and call-room identity.
    req.send_id = senderId;
    const sender = await this.resolveSender(senderId);
    if (sender) {
      req.send_name = sender.name;
      req.send_avatar = sender.avatar;
    }

    const msg = {
      uuid: newMessage(),
      sessionId: req.session_id,
      type: req.type,
      content: req.content,
      url: req.url,
      sendId: req.send_id,
      sendName: req.send_name,
      sendAvatar: req.send_avatar,
      receiveId: req.receive_id,
      fileType: req.file_type,
      fileName: req.file_name,
      fileSize: req.file_size,
      avData: req.av_data,
      createdAt: nowDate(),
    };

    if (req.type === MessageAudioOrVideo) {
      await this.handleAVMessage(req, msg);
      return;
    }

    try {
      await this.db.message.create({
        data: {
          uuid: msg.uuid,
          sessionId: msg.sessionId,
          type: msg.type,
          content: msg.content,
          url: msg.url,
          sendId: msg.sendId,
          sendName: msg.sendName,
          sendAvatar: msg.sendAvatar,
          receiveId: msg.receiveId,
          fileType: msg.fileType,
          fileName: msg.fileName,
          fileSize: msg.fileSize,
          avData: msg.avData,
          createdAt: msg.createdAt,
        },
      });
    } catch {
      return;
    }

    // Surface the conversation in both sides' session lists before fan-out.
    if (msg.receiveId.startsWith("U")) {
      await this.sessions.touchDirectSessions(msg.sendId, msg.receiveId);
    }

    await this.broadcast(req, msg, true);
    this.dispatchToYukino(msg);
  }

  // Reads the authoritative display fields for a user so a client cannot
  // spoof someone else's name or avatar. Returns null when unavailable, in
  // which case the caller keeps what the client sent.
  private async resolveSender(uuid: string): Promise<ResolvedSender | null> {
    let cached = await this.cache.getUser<CachedUser>(uuid);
    if (!cached) {
      const row = await this.db.userInfo.findFirst({
        where: { uuid, deletedAt: null },
      });
      if (!row) return null;
      cached = {
        uuid: row.uuid,
        nickname: row.nickname,
        telephone: row.telephone,
        email: row.email,
        avatar: row.avatar,
        gender: row.gender,
        signature: row.signature,
        birthday: row.birthday,
        created_at: row.createdAt.toISOString(),
        last_online_at: null,
        last_offline_at: null,
        is_admin: row.isAdmin,
        status: row.status,
      };
      await this.cache.setUser(uuid, cached);
    }
    return { name: cached.nickname, avatar: cached.avatar };
  }

  // Delivers the message to its receiver(s).
  private async broadcast(
    req: ChatFrame,
    msg: {
      uuid: string;
      sendId: string;
      sendName: string;
      sendAvatar: string;
      receiveId: string;
      type: number;
      content: string;
      url: string;
      fileSize: string;
      fileName: string;
      fileType: string;
      avData: string;
      createdAt: Date;
    },
    echoToSender: boolean,
  ) {
    if (msg.receiveId === "") return;
    const item: MessageListItem = {
      uuid: msg.uuid,
      send_id: msg.sendId,
      send_name: msg.sendName,
      send_avatar: req.send_avatar,
      receive_id: msg.receiveId,
      type: msg.type,
      content: msg.content,
      url: msg.url,
      file_size: msg.fileSize,
      file_name: msg.fileName,
      file_type: msg.fileType,
      created_at: fmtDateTime(msg.createdAt),
    };
    if (msg.type === MessageAudioOrVideo) {
      item.av_data = msg.avData;
    }
    const payload = JSON.stringify(item);

    let targets: string[];
    if (msg.receiveId.startsWith("U")) {
      targets = [msg.receiveId];
      if (echoToSender && msg.sendId !== msg.receiveId) {
        targets.push(msg.sendId);
      }
    } else if (msg.receiveId.startsWith("G")) {
      const group = await this.db.groupInfo.findFirst({
        where: { uuid: msg.receiveId, deletedAt: null },
      });
      if (!group) return;
      if (msg.type !== MessageAudioOrVideo) {
        await this.sessions.touchGroupSessions(group);
      }
      targets = group.members.filter((m) => echoToSender || m !== msg.sendId);
    } else {
      return;
    }

    let delivered = 0;
    for (const id of targets) {
      const before = this.hub.isOnline(id);
      if (before) {
        this.hub.sendRaw(payload, [id]);
        delivered++;
      }
    }
    if (delivered > 0 && msg.type !== MessageAudioOrVideo) {
      await this.markSent(msg.uuid);
    }
  }

  private async markSent(uuid: string) {
    await this.db.message
      .update({ where: { uuid }, data: { status: 1, sendAt: nowDate() } })
      .catch(() => {});
  }

  // Interprets audio/video signaling. Call lifecycle frames go through the
  // call manager for busy tracking and room membership; sdp/candidate frames
  // are relayed point-to-point.
  private async handleAVMessage(
    req: ChatFrame,
    msg: {
      uuid: string;
      sendId: string;
      sendName: string;
      sendAvatar: string;
      receiveId: string;
      type: number;
      content: string;
      url: string;
      fileSize: string;
      fileName: string;
      fileType: string;
      avData: string;
      createdAt: Date;
    },
  ) {
    let av: AVSignal = { messageId: "", type: "", media: "", room_id: "" };
    try {
      av = { ...av, ...(JSON.parse(req.av_data) as Partial<AVSignal>) };
    } catch {
      // Zero values, like the Go unmarshal ignoring errors.
    }

    // Only persist certain AV signals.
    if (
      av.messageId === "PROXY" &&
      ["start_call", "receive_call", "reject_call"].includes(av.type)
    ) {
      await this.db.message
        .create({
          data: {
            uuid: msg.uuid,
            sessionId: req.session_id,
            type: msg.type,
            content: msg.content,
            url: msg.url,
            sendId: msg.sendId,
            sendName: msg.sendName,
            sendAvatar: msg.sendAvatar,
            receiveId: msg.receiveId,
            fileType: msg.fileType,
            fileName: msg.fileName,
            fileSize: msg.fileSize,
            avData: msg.avData,
            createdAt: msg.createdAt,
          },
        })
        .catch(() => {});
    }

    let roomId = av.room_id;
    if (roomId === "") {
      roomId = CallManager.roomId(msg.sendId, msg.receiveId);
    }

    if (av.messageId === "PROXY" && av.type === "start_call") {
      await this.handleStartCall(req, msg, roomId);
      return;
    }
    if (av.messageId === "PROXY" && av.type === "receive_call") {
      // 1v1 accept: the callee joins the pair room, then the caller is told
      // to create the offer. AV signaling never echoes back to the sender.
      this.calls.join(roomId, msg.sendId);
      await this.broadcast(req, msg, false);
      return;
    }
    if (av.messageId === "PROXY" && av.type === "join_call") {
      // Group accept: existing members are notified so each one creates an
      // offer towards the newcomer.
      const others = this.calls.members(roomId).filter((m) => m !== msg.sendId);
      this.calls.join(roomId, msg.sendId);
      this.sendAVToUsers(req, msg, others);
      return;
    }
    if (av.messageId === "PROXY" && av.type === "reject_call") {
      // Decline: free everyone in a 1v1 pair room; group calls continue.
      if (msg.receiveId.startsWith("U")) {
        for (const member of this.calls.members(roomId)) {
          this.calls.leave(member);
        }
        await this.broadcast(req, msg, false);
      }
      return;
    }
    if (av.messageId === "PEER_LEAVE" || (av.messageId === "PROXY" && av.type === "leave_call")) {
      const [leftRoom, remaining] = this.calls.leave(msg.sendId);
      const notified = new Set<string>();
      if (leftRoom !== "") {
        this.sendAVToUsers(req, msg, remaining);
        for (const m of remaining) notified.add(m);
      }
      // A caller hanging up before the callee answered must still close the
      // callee's incoming-call popup.
      if (msg.receiveId.startsWith("U") && !notified.has(msg.receiveId)) {
        await this.broadcast(req, msg, false);
      }
      return;
    }
    // sdp / candidate and any custom frames: plain relay.
    await this.broadcast(req, msg, false);
  }

  // Validates availability, marks the caller busy and invites the callee(s).
  // Failures are reported back to the caller as call_failed.
  private async handleStartCall(
    req: ChatFrame,
    msg: {
      uuid: string;
      sendId: string;
      sendName: string;
      sendAvatar: string;
      receiveId: string;
      type: number;
      content: string;
      url: string;
      fileSize: string;
      fileName: string;
      fileType: string;
      avData: string;
      createdAt: Date;
    },
    roomId: string,
  ) {
    const caller = msg.sendId;
    if (isYukino(msg.receiveId)) {
      this.sendCallFailed(caller, roomId, "Yukino is a text-only assistant and cannot take calls");
      return;
    }
    if (this.calls.isBusy(caller) && !this.calls.inRoom(roomId, caller)) {
      this.sendCallFailed(caller, roomId, "you are already in a call");
      return;
    }

    if (msg.receiveId.startsWith("U")) {
      const callee = msg.receiveId;
      if (!this.hub.isOnline(callee)) {
        this.sendCallFailed(caller, roomId, "the other user is offline");
        return;
      }
      if (this.calls.isBusy(callee)) {
        this.sendCallFailed(caller, roomId, "the other user is in a call");
        return;
      }
      this.calls.join(roomId, caller);
      await this.broadcast(req, msg, false);
      return;
    }

    if (msg.receiveId.startsWith("G")) {
      const group = await this.db.groupInfo.findFirst({
        where: { uuid: msg.receiveId, deletedAt: null },
      });
      if (!group) {
        this.sendCallFailed(caller, roomId, "group not found");
        return;
      }
      const alreadyActive = this.calls.members(roomId).length > 0;
      const candidates: string[] = [];
      let isMember = false;
      for (const member of group.members) {
        if (member === caller) {
          isMember = true;
          continue;
        }
        if (!this.hub.isOnline(member)) continue;
        if (this.calls.isBusy(member)) continue;
        candidates.push(member);
      }
      if (!isMember) {
        this.sendCallFailed(caller, roomId, "you are not a member of this group");
        return;
      }
      if (candidates.length === 0 && !alreadyActive) {
        this.sendCallFailed(caller, roomId, "no one is available for the call");
        return;
      }
      this.calls.join(roomId, caller);
      this.sendAVToUsers(req, msg, candidates);
    }
  }

  // Relays an AV frame to an explicit target list.
  private sendAVToUsers(
    req: ChatFrame,
    msg: {
      uuid: string;
      sendId: string;
      sendName: string;
      receiveId: string;
      type: number;
      content: string;
      url: string;
      fileSize: string;
      fileName: string;
      fileType: string;
      avData: string;
      createdAt: Date;
    },
    targets: string[],
  ) {
    if (targets.length === 0) return;
    const item: MessageListItem = {
      uuid: msg.uuid,
      send_id: msg.sendId,
      send_name: msg.sendName,
      send_avatar: req.send_avatar,
      receive_id: msg.receiveId,
      type: msg.type,
      content: msg.content,
      url: msg.url,
      file_size: msg.fileSize,
      file_name: msg.fileName,
      file_type: msg.fileType,
      created_at: fmtDateTime(msg.createdAt),
      av_data: msg.avData,
    };
    this.hub.sendRaw(JSON.stringify(item), targets);
  }

  // Reports a failed call attempt back to the caller.
  private sendCallFailed(uuid: string, roomId: string, reason: string) {
    const item: MessageListItem = {
      uuid: "",
      send_id: "SYSTEM",
      send_name: "",
      send_avatar: "",
      receive_id: uuid,
      type: MessageAudioOrVideo,
      content: "",
      url: "",
      file_size: "",
      file_name: "",
      file_type: "",
      created_at: fmtDateTime(nowDate()),
      av_data: JSON.stringify({
        messageId: "PROXY",
        type: "call_failed",
        room_id: roomId,
        reason,
      }),
    };
    this.hub.sendRaw(JSON.stringify(item), [uuid]);
  }

  // Routes a stored direct message into the assistant owned by its sender.
  // Group threads are deliberately left out: Yukino only takes part in
  // one-to-one conversations.
  private dispatchToYukino(msg: {
    uuid: string;
    sessionId: string;
    sendId: string;
    receiveId: string;
    type: number;
    content: string;
  }) {
    if (!isYukino(msg.receiveId) || msg.sendId === YUKINO_UUID) return;
    if (!this.agent) return;
    if (msg.type !== MessageText) {
      // Uploads are hidden in the assistant thread, so anything else here came
      // from another client and deserves an answer rather than silence.
      this.agent.saveAssistantText(
        msg.sendId,
        msg.sessionId,
        "I can only read text messages — please describe what you need in writing.",
      );
      return;
    }
    this.agent.dispatch(msg.sendId, msg.sessionId, msg.uuid, msg.content);
  }
}

function coerceFrame(parsed: unknown): ChatFrame {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("not an object");
  }
  const o = parsed as Record<string, unknown>;
  const typeVal = o.type;
  if (typeof typeVal !== "number" || !Number.isInteger(typeVal)) {
    throw new Error("invalid type");
  }
  // Like Go's json.Unmarshal: missing string fields are zero values; only a
  // wrong-typed field rejects the frame.
  const frame: ChatFrame = {
    session_id: "",
    type: typeVal,
    content: "",
    url: "",
    send_id: "",
    send_name: "",
    send_avatar: "",
    receive_id: "",
    file_type: "",
    file_name: "",
    file_size: "",
    av_data: "",
  };
  for (const key of Object.keys(frame) as (keyof ChatFrame)[]) {
    if (key === "type") continue;
    const v = o[key];
    if (v === undefined) continue;
    if (typeof v !== "string") throw new Error(`invalid ${key}`);
    frame[key] = v;
  }
  return frame;
}
