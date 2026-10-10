import { create } from "zustand";

import { isGroupId } from "@/service/schemas";
import useWsStore from "@/store/ws";
import {
  CallManager,
  type CallKind,
  type CallMedia,
  type CallPeer,
  type IncomingCall,
} from "@/utils/rtc";
import { showToast } from "@/utils/toast";

const NO_ANSWER_TIMEOUT_MS = 45_000;

export type CallPhase = "idle" | "ringing" | "dialing" | "active";

export interface CallState {
  phase: CallPhase;
  media: CallMedia;
  kind: CallKind;
  title: string;
  roomId: string;
  incoming: IncomingCall | null;
  localStream: MediaStream | null;
  peers: CallPeer[];
  microphoneOn: boolean;
  connectedAt: number | null;

  dial: (options: {
    conversationId: string;
    sessionId: string;
    title: string;
    media: CallMedia;
  }) => void;
  accept: () => void;
  decline: () => void;
  hangUp: () => void;
}

const idle = {
  phase: "idle",
  title: "",
  roomId: "",
  incoming: null,
  localStream: null,
  peers: [],
  microphoneOn: true,
  connectedAt: null,
} satisfies Partial<CallState>;

const manager = new CallManager();
let noAnswerTimer: ReturnType<typeof setTimeout> | null = null;

function clearNoAnswerTimer() {
  if (noAnswerTimer) {
    clearTimeout(noAnswerTimer);
    noAnswerTimer = null;
  }
}

const useCallStore = create<CallState>((set, get) => ({
  ...idle,
  media: "video",
  kind: "direct",

  dial(options) {
    if (get().phase !== "idle") {
      showToast("You are already in a call", "warning");
      return;
    }
    set({
      ...idle,
      phase: "dialing",
      media: options.media,
      kind: isGroupId(options.conversationId) ? "group" : "direct",
      title: options.title,
    });
    clearNoAnswerTimer();
    noAnswerTimer = setTimeout(() => {
      if (get().phase === "dialing") {
        showToast("No answer", "info");
        manager.hangUp();
      }
    }, NO_ANSWER_TIMEOUT_MS);

    manager.dial(options).catch(() => {
      manager.hangUp();
      showToast("Could not access your microphone or camera", "error");
    });
  },

  accept() {
    const { incoming } = get();
    if (!incoming) return;
    clearNoAnswerTimer();
    set({ phase: "dialing", incoming: null });
    manager.accept(incoming).catch(() => {
      manager.decline(incoming);
      showToast("Could not access your microphone or camera", "error");
    });
  },

  decline() {
    const { incoming } = get();
    if (incoming) manager.decline(incoming);
    clearNoAnswerTimer();
    set({ ...idle });
  },

  hangUp() {
    clearNoAnswerTimer();
    manager.hangUp();
  },
}));

manager.onLocalStream = (localStream) => useCallStore.setState({ localStream });

manager.onPeers = (peers) => {
  const { phase } = useCallStore.getState();
  if (phase === "idle") return;
  const connected = peers.length > 0;
  useCallStore.setState((state) => ({
    peers,
    phase: connected ? "active" : "dialing",
    connectedAt: connected ? (state.connectedAt ?? Date.now()) : null,
  }));
};

manager.onEnded = (reason) => {
  clearNoAnswerTimer();
  useCallStore.setState({ ...idle });
  if (reason) showToast(reason, "info");
};

useWsStore.getState().subscribeToSignals((frame) => {
  const outcome = manager.handleSignal(frame);
  if (!outcome) return;

  if (outcome.kind === "cancelled") {
    const { phase, incoming } = useCallStore.getState();
    if (phase === "ringing" && incoming?.from === outcome.from) {
      useCallStore.setState({ ...idle });
      showToast("Missed call", "info");
    }
    return;
  }

  const { call } = outcome;
  useCallStore.setState({
    ...idle,
    phase: "ringing",
    media: call.media,
    kind: call.kind,
    title: call.name,
    roomId: call.roomId,
    incoming: call,
  });
});

export const toggleMicrophone = () =>
  useCallStore.setState({ microphoneOn: manager.toggleMicrophone() });

export default useCallStore;
