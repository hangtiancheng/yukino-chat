import { MessageType, isGroupId, type Message } from "@/service/schemas";
import useAuthStore from "@/store/auth";
import useWsStore from "@/store/ws";

export type CallMedia = "audio" | "video";
export type CallKind = "direct" | "group";

export interface CallPeer {
  id: string;
  name: string;
  stream: MediaStream;
}

export interface IncomingCall {
  from: string;
  name: string;
  avatar: string;
  media: CallMedia;
  kind: CallKind;
  roomId: string;
  conversationId: string;
}

export type SignalOutcome =
  | { kind: "incoming"; call: IncomingCall }
  | { kind: "cancelled"; from: string }
  | undefined;

interface PeerLink {
  pc: RTCPeerConnection;
  stream: MediaStream;
  queued: RTCIceCandidateInit[];
}

export function callRoomId(selfId: string, conversationId: string): string {
  if (isGroupId(conversationId)) return conversationId;
  return `P:${[selfId, conversationId].sort().join(":")}`;
}

export class CallManager {
  onLocalStream: ((stream: MediaStream | null) => void) | null = null;
  onPeers: ((peers: CallPeer[]) => void) | null = null;
  onEnded: ((reason?: string) => void) | null = null;

  private media: CallMedia = "video";
  private kind: CallKind = "direct";
  private roomId = "";
  private conversationId = "";
  private sessionId = "";
  private localStream: MediaStream | null = null;
  private links = new Map<string, PeerLink>();
  private names = new Map<string, string>();
  private engaged = false;

  get inCall(): boolean {
    return this.engaged;
  }

  async dial(options: {
    conversationId: string;
    sessionId: string;
    media: CallMedia;
  }) {
    this.adopt({
      conversationId: options.conversationId,
      sessionId: options.sessionId,
      media: options.media,
      kind: isGroupId(options.conversationId) ? "group" : "direct",
      roomId: callRoomId(
        useAuthStore.getState().userInfo.uuid,
        options.conversationId,
      ),
    });
    await this.openLocalStream();
    this.signal("start_call", { media: this.media });
  }

  async accept(call: IncomingCall) {
    this.adopt({ ...call, sessionId: "" });
    await this.openLocalStream();
    this.signal(this.kind === "group" ? "join_call" : "receive_call");
  }

  decline(call: IncomingCall) {
    this.adopt({ ...call, sessionId: "" });
    if (this.kind === "direct") this.signal("reject_call");
    this.end();
  }

  hangUp() {
    if (this.engaged) this.signal("leave_call");
    this.end();
  }

  toggleMicrophone(): boolean {
    const tracks = this.localStream?.getAudioTracks() ?? [];
    const enabled = !tracks.some((track) => track.enabled);
    for (const track of tracks) track.enabled = enabled;
    return enabled;
  }

  handleSignal(frame: Message): SignalOutcome {
    const av = parseAvData(frame.av_data);
    if (!av) return undefined;

    const messageId = av.messageId as string | undefined;
    const type = av.type as string | undefined;
    const from = frame.send_id;
    if (frame.send_name) this.names.set(from, frame.send_name);

    if (messageId === "PEER_LEAVE") return this.peerLeft(from);
    if (messageId !== "PROXY") return undefined;
    if (type === "start_call") return this.describeIncoming(frame, av);

    if (!this.engaged) return undefined;
    const roomId = (av.room_id as string) || "";
    if (roomId && this.roomId && roomId !== this.roomId) return undefined;

    switch (type) {
      case "call_failed":
        this.end((av.reason as string) || "The call could not be started");
        return undefined;
      case "reject_call":
        this.end("The call was declined");
        return undefined;
      case "leave_call":
        return this.peerLeft(from);
      case "receive_call":
      case "join_call":
        void this.offerTo(from);
        return undefined;
    }

    const data = av.messageData as Record<string, unknown> | undefined;
    if (type === "sdp") {
      const sdp = data?.sdp as RTCSessionDescriptionInit | undefined;
      if (sdp?.type === "offer") void this.answerTo(from, sdp);
      else if (sdp?.type === "answer") void this.applyAnswer(from, sdp);
    } else if (type === "candidate") {
      const candidate = data?.candidate as RTCIceCandidateInit | undefined;
      if (candidate) void this.addCandidate(from, candidate);
    }
    return undefined;
  }

  private adopt(call: {
    conversationId: string;
    sessionId: string;
    media: CallMedia;
    kind: CallKind;
    roomId: string;
  }) {
    this.teardown();
    this.conversationId = call.conversationId;
    this.sessionId = call.sessionId;
    this.media = call.media;
    this.kind = call.kind;
    this.roomId = call.roomId;
    this.engaged = true;
  }

  private describeIncoming(
    frame: Message,
    av: Record<string, unknown>,
  ): SignalOutcome {
    if (this.engaged) return undefined;
    const kind: CallKind = isGroupId(frame.receive_id) ? "group" : "direct";
    const conversationId = kind === "group" ? frame.receive_id : frame.send_id;
    return {
      kind: "incoming",
      call: {
        from: frame.send_id,
        name: frame.send_name,
        avatar: frame.send_avatar,
        media: av.media === "audio" ? "audio" : "video",
        kind,
        roomId:
          (av.room_id as string) ||
          callRoomId(useAuthStore.getState().userInfo.uuid, conversationId),
        conversationId,
      },
    };
  }

  private peerLeft(peerId: string): SignalOutcome {
    if (!this.engaged) return { kind: "cancelled", from: peerId };
    this.dropPeer(peerId);
    return undefined;
  }

  private async openLocalStream() {
    if (this.localStream) return this.localStream;
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: this.media === "video",
    });
    this.onLocalStream?.(this.localStream);
    return this.localStream;
  }

  private ensureLink(peerId: string): PeerLink {
    const existing = this.links.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection();
    const stream = new MediaStream();
    const link: PeerLink = { pc, stream, queued: [] };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signal("candidate", {}, peerId, {
          candidate: event.candidate.toJSON(),
        });
      }
    };
    pc.ontrack = (event) => {
      stream.addTrack(event.track);
      this.publishPeers();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") this.dropPeer(peerId);
    };

    const local = this.localStream;
    if (local) {
      for (const track of local.getTracks()) pc.addTrack(track, local);
    }

    this.links.set(peerId, link);
    this.publishPeers();
    return link;
  }

  private async offerTo(peerId: string) {
    const { pc } = this.ensureLink(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signal("sdp", {}, peerId, { sdp: offer });
  }

  private async answerTo(peerId: string, sdp: RTCSessionDescriptionInit) {
    const link = this.ensureLink(peerId);
    await link.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.flushCandidates(link);
    const answer = await link.pc.createAnswer();
    await link.pc.setLocalDescription(answer);
    this.signal("sdp", {}, peerId, { sdp: answer });
  }

  private async applyAnswer(peerId: string, sdp: RTCSessionDescriptionInit) {
    const link = this.links.get(peerId);
    if (!link) return;
    await link.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.flushCandidates(link);
  }

  private async addCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const link = this.ensureLink(peerId);
    if (!link.pc.remoteDescription) {
      link.queued.push(candidate);
      return;
    }
    await link.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  private async flushCandidates(link: PeerLink) {
    for (const candidate of link.queued.splice(0)) {
      await link.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  private dropPeer(peerId: string) {
    const link = this.links.get(peerId);
    if (!link) return;
    link.pc.onconnectionstatechange = null;
    link.pc.close();
    this.links.delete(peerId);
    this.publishPeers();
    if (this.kind === "direct") this.end();
  }

  private publishPeers() {
    this.onPeers?.(
      Array.from(this.links, ([id, link]) => ({
        id,
        name: this.names.get(id) ?? id,
        stream: link.stream,
      })),
    );
  }

  private end(reason?: string) {
    this.teardown();
    this.onEnded?.(reason);
  }

  private teardown() {
    for (const link of this.links.values()) {
      link.pc.onconnectionstatechange = null;
      link.pc.close();
    }
    this.links.clear();
    this.names.clear();
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.localStream = null;
    this.engaged = false;
    this.roomId = "";
    this.conversationId = "";
    this.onLocalStream?.(null);
    this.publishPeers();
  }

  private signal(
    type: string,
    extra: Record<string, unknown> = {},
    receiveId = this.conversationId,
    messageData?: Record<string, unknown>,
  ) {
    if (!receiveId) return;
    const { userInfo } = useAuthStore.getState();
    useWsStore.getState().send({
      session_id: this.sessionId,
      type: MessageType.AvSignal,
      content: "",
      url: "",
      send_id: userInfo.uuid,
      send_name: userInfo.nickname,
      send_avatar: userInfo.avatar,
      receive_id: receiveId,
      file_size: "",
      file_name: "",
      file_type: "",
      av_data: JSON.stringify({
        messageId: "PROXY",
        type,
        room_id: this.roomId,
        ...extra,
        ...(messageData ? { messageData } : {}),
      }),
    });
  }
}

function parseAvData(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const payload: unknown = JSON.parse(raw);
    return typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
