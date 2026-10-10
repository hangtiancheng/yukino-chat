import { uniqBy } from "es-toolkit";
import { create } from "zustand";

import { wsUrl } from "@/env";
import { queryClient } from "@/lib/query-client";
import { keys } from "@/service/queries";
import {
  MessageType,
  SYSTEM_SENDER,
  SystemTopic,
  isGroupId,
  messageSchema,
  type Message,
  type OutgoingFrame,
} from "@/service/schemas";
import { showToast } from "@/utils/toast";
import useAuthStore from "./auth";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type SignalListener = (frame: Message) => void;

export interface WsState {
  status: ConnectionStatus;
  connect: (userId: string) => void;
  disconnect: () => void;
  send: (frame: OutgoingFrame) => void;
  subscribeToSignals: (listener: SignalListener) => () => void;
}

const OVERFLOW_TYPE = -1;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30_000;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = INITIAL_RECONNECT_DELAY;
let intentionalClose = false;
let reconnecting = false;
const signalListeners = new Set<SignalListener>();

const staleKeysByTopic: Record<string, ReadonlyArray<readonly unknown[]>> = {
  [SystemTopic.Session]: [keys.sessions.all],
  [SystemTopic.Contact]: [keys.contacts.all],
  [SystemTopic.Apply]: [keys.contacts.all],
  [SystemTopic.Group]: [keys.groups.all, keys.contacts.all],
  [SystemTopic.Online]: [keys.chatroom.online, keys.contacts.all],
};

function invalidate(queryKey: readonly unknown[]) {
  void queryClient.invalidateQueries({ queryKey });
}

function dispatchSignal(frame: Message) {
  for (const listener of signalListeners) {
    listener(frame);
  }
}

function conversationIdOf(frame: Message, selfId: string): string {
  if (isGroupId(frame.receive_id)) return frame.receive_id;
  return frame.send_id === selfId ? frame.receive_id : frame.send_id;
}

function appendToConversation(frame: Message) {
  const selfId = useAuthStore.getState().userInfo.uuid;
  if (!selfId) return;

  const queryKey = keys.messages.with(selfId, conversationIdOf(frame, selfId));
  if (queryClient.getQueryState(queryKey)) {
    queryClient.setQueryData<Message[]>(queryKey, (current) =>
      uniqBy([...(current ?? []), frame], (message) => message.uuid),
    );
  }
  invalidate(keys.sessions.all);
}

function handleFrame(raw: unknown) {
  if (typeof raw !== "string" || !raw.startsWith("{")) return;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const parsed = messageSchema.safeParse(payload);
  if (!parsed.success) return;
  const frame = parsed.data;

  if (frame.type === OVERFLOW_TYPE) {
    showToast(frame.content || "Message send failed, please retry", "warning");
    return;
  }
  if (frame.type === MessageType.AvSignal) {
    dispatchSignal(frame);
    return;
  }
  if (frame.send_id === SYSTEM_SENDER) {
    for (const queryKey of staleKeysByTopic[frame.content] ?? []) {
      invalidate(queryKey);
    }
    return;
  }
  appendToConversation(frame);
}

function scheduleReconnect(userId: string) {
  if (intentionalClose) return;
  reconnectTimer = setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    openSocket(userId);
  }, reconnectDelay);
}

function openSocket(userId: string) {
  if (socket) {
    socket.onclose = null;
    socket.close();
  }

  const { token } = useAuthStore.getState();
  if (!token) {
    useWsStore.setState({ status: "disconnected" });
    return;
  }

  useWsStore.setState({ status: "connecting" });

  const next = new WebSocket(
    `${wsUrl}/wss?client_id=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`,
  );
  next.onopen = () => {
    reconnectDelay = INITIAL_RECONNECT_DELAY;
    useWsStore.setState({ status: "connected" });
    if (reconnecting) {
      reconnecting = false;
      void queryClient.invalidateQueries();
    }
  };
  next.onmessage = (event: MessageEvent) => handleFrame(event.data);
  next.onclose = () => {
    socket = null;
    reconnecting = true;
    useWsStore.setState({ status: "disconnected" });
    scheduleReconnect(userId);
  };
  next.onerror = () => next.close();
  socket = next;
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

const useWsStore = create<WsState>(() => ({
  status: "disconnected",

  connect(userId: string) {
    if (!userId) return;
    intentionalClose = false;
    reconnecting = false;
    reconnectDelay = INITIAL_RECONNECT_DELAY;
    clearReconnectTimer();
    openSocket(userId);
  },

  disconnect() {
    intentionalClose = true;
    clearReconnectTimer();
    if (socket) {
      socket.onclose = null;
      socket.close();
      socket = null;
    }
    useWsStore.setState({ status: "disconnected" });
  },

  send(frame: OutgoingFrame) {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
    } else {
      showToast("Not connected, message not sent", "error");
    }
  },

  subscribeToSignals(listener: SignalListener) {
    signalListeners.add(listener);
    return () => signalListeners.delete(listener);
  },
}));

export default useWsStore;
