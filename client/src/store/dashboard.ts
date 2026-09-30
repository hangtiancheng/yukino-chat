import { create } from "zustand";

export interface EntrySnapshot {
  key: string;
  size: number;
  expire_at: number;
  level: number;
}

export interface GroupSnapshot {
  name: string;
  stats: Record<string, unknown>;
  entries: EntrySnapshot[];
}

export type DashboardStatus = "disconnected" | "connecting" | "connected";

export interface DashboardState {
  groups: GroupSnapshot[];
  status: DashboardStatus;
  connect: (url: string) => void;
  disconnect: () => void;
  deleteKey: (group: string, key: string) => void;
}

const RETRY_DELAY_MS = 3000;

let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;

function clearRetryTimer() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

const useDashboardStore = create<DashboardState>(() => ({
  groups: [],
  status: "disconnected",

  connect(url: string) {
    intentionalClose = false;
    clearRetryTimer();
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    useDashboardStore.setState({ status: "connecting" });

    const next = new WebSocket(url);
    next.onopen = () => useDashboardStore.setState({ status: "connected" });
    next.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          type?: string;
          groups?: GroupSnapshot[];
        };
        if (payload.type === "snapshot") {
          useDashboardStore.setState({ groups: payload.groups ?? [] });
        }
      } catch {
        return;
      }
    };
    next.onclose = () => {
      socket = null;
      useDashboardStore.setState({ status: "disconnected" });
      if (!intentionalClose) {
        retryTimer = setTimeout(() => useDashboardStore.getState().connect(url), RETRY_DELAY_MS);
      }
    };
    next.onerror = () => next.close();
    socket = next;
  },

  disconnect() {
    intentionalClose = true;
    clearRetryTimer();
    if (socket) {
      socket.onclose = null;
      socket.close();
      socket = null;
    }
    useDashboardStore.setState({ status: "disconnected", groups: [] });
  },

  deleteKey(group: string, key: string) {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ action: "delete", group, key }));
    }
  },
}));

export default useDashboardStore;
