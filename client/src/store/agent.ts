import { create } from "zustand";

import { wsUrl } from "@/env";
import {
  toolKey,
  type AgentNotification,
  type AgentRequest,
  type AgentItem,
  type AgentConnectionStatus,
  type PermissionResponse,
  type SlashCommand,
} from "@/service/agent-schemas";
import useAuthStore from "./auth";

export interface AgentState {
  status: AgentConnectionStatus;
  ready: boolean;
  items: AgentItem[];
  commands: SlashCommand[];
  usage: { inputTokens: number; outputTokens: number } | null;
  streaming: boolean;
  model: string;
  anchorId: string;
  currentStreamId: string | null;
  currentThinkingId: string | null;

  connect: () => void;
  disconnect: () => void;
  respondPermission: (id: string, response: PermissionResponse) => void;
  answerQuestions: (id: string, answers: Record<string, string>) => void;
  stop: () => void;
}

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30_000;
const PING_INTERVAL = 10_000;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let reconnectDelay = INITIAL_RECONNECT_DELAY;
let intentionalClose = false;
let itemCounter = 0;
let requestCounter = 0;

function nextId(prefix: string): string {
  itemCounter += 1;
  return `${prefix}_${itemCounter}`;
}

function send(request: AgentRequest) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  requestCounter += 1;
  socket.send(
    JSON.stringify({ jsonrpc: "2.0", id: requestCounter, ...request }),
  );
}

type Snapshot = Omit<
  AgentState,
  "connect" | "disconnect" | "respondPermission" | "answerQuestions" | "stop"
>;

const emptySnapshot: Snapshot = {
  status: "idle",
  ready: false,
  items: [],
  commands: [],
  usage: null,
  streaming: false,
  model: "",
  anchorId: "",
  currentStreamId: null,
  currentThinkingId: null,
};

function withItem(state: Snapshot, item: AgentItem): Snapshot {
  return { ...state, items: [...state.items, item] };
}

function notice(
  state: Snapshot,
  tone: "info" | "error" | "done",
  content: string,
): Snapshot {
  const last = state.items.at(-1);
  if (
    last?.kind === "notice" &&
    last.tone === tone &&
    last.content === content
  ) {
    return state;
  }
  return withItem(state, {
    kind: "notice",
    id: nextId("notice"),
    anchorId: state.anchorId,
    tone,
    content,
  });
}

function finalizeThinking(state: Snapshot): Snapshot {
  const id = state.currentThinkingId;
  if (id === null) return state;
  return {
    ...state,
    currentThinkingId: null,
    items: state.items.map((item) =>
      item.kind === "thinking" && item.id === id
        ? { ...item, done: true }
        : item,
    ),
  };
}

function settlePrompts(state: Snapshot): Snapshot {
  return {
    ...state,
    items: state.items.map((item) => {
      if (item.kind === "permission" && item.response === null) {
        return { ...item, response: "deny" as const };
      }
      if (item.kind === "question" && !item.answered) {
        return { ...item, answered: true };
      }
      return item;
    }),
  };
}

function apply(state: Snapshot, event: AgentNotification): Snapshot {
  switch (event.method) {
    case "session/connected":
      return {
        ...state,
        model: event.params.model,
        streaming: event.params.streaming,
        ready: event.params.ready,
        anchorId: event.params.anchorId || state.anchorId,
        usage:
          event.params.inputTokens || event.params.outputTokens
            ? {
                inputTokens: event.params.inputTokens,
                outputTokens: event.params.outputTokens,
              }
            : state.usage,
      };

    case "session/ready":
      return { ...state, ready: true };

    case "session/commands":
      return { ...state, commands: event.params ?? [] };

    case "agent/run_start":
      return {
        ...state,
        streaming: true,
        anchorId: event.params.userMessageId,
      };

    case "agent/thinking_text": {
      const id = state.currentThinkingId;
      if (id === null) {
        const created = nextId("think");
        return withItem(
          { ...state, currentThinkingId: created },
          {
            kind: "thinking",
            id: created,
            anchorId: state.anchorId,
            content: event.params.text,
            done: false,
          },
        );
      }
      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === "thinking" && item.id === id
            ? { ...item, content: item.content + event.params.text }
            : item,
        ),
      };
    }

    case "agent/stream_text": {
      const next = finalizeThinking(state);
      const id = next.currentStreamId;
      if (id === null) {
        const created = nextId("stream");
        return withItem(
          { ...next, currentStreamId: created },
          {
            kind: "stream",
            id: created,
            anchorId: next.anchorId,
            content: event.params.text,
            streaming: true,
            messageId: "",
          },
        );
      }
      return {
        ...next,
        items: next.items.map((item) =>
          item.kind === "stream" && item.id === id
            ? { ...item, content: item.content + event.params.text }
            : item,
        ),
      };
    }

    case "agent/stream_end": {
      const { messageId, text } = event.params;
      const anchorId = messageId || state.anchorId;
      const id = state.currentStreamId;
      if (id === null) {
        if (messageId) return { ...state, anchorId };
        return withItem(
          { ...state, anchorId },
          {
            kind: "stream",
            id: nextId("stream"),
            anchorId: state.anchorId,
            content: text,
            streaming: false,
            messageId: "",
          },
        );
      }
      return {
        ...state,
        anchorId,
        currentStreamId: null,
        items: state.items.map((item) =>
          item.kind === "stream" && item.id === id
            ? { ...item, streaming: false, messageId }
            : item,
        ),
      };
    }

    case "agent/tool_use": {
      const next = finalizeThinking(state);
      const key = toolKey(event.params.toolName, event.params.toolId);
      const known = next.items.some(
        (item) =>
          item.kind === "tool" && toolKey(item.toolName, item.toolId) === key,
      );
      if (known) {
        if (!event.params.args) return next;
        return {
          ...next,
          items: next.items.map((item) =>
            item.kind === "tool" && toolKey(item.toolName, item.toolId) === key
              ? { ...item, args: event.params.args }
              : item,
          ),
        };
      }
      return withItem(next, {
        kind: "tool",
        id: nextId("tool"),
        anchorId: next.anchorId,
        toolId: event.params.toolId,
        toolName: event.params.toolName,
        args: event.params.args,
        status: "running",
        output: "",
        elapsed: 0,
      });
    }

    case "agent/tool_result": {
      const key = toolKey(event.params.toolName, event.params.toolId);
      let matched = false;
      const items = state.items.map((item) => {
        if (
          item.kind !== "tool" ||
          toolKey(item.toolName, item.toolId) !== key
        ) {
          return item;
        }
        matched = true;
        return {
          ...item,
          status: event.params.isError ? ("error" as const) : ("ok" as const),
          output: event.params.output,
          elapsed: event.params.elapsed,
        };
      });
      if (matched) return { ...state, items };
      return withItem(state, {
        kind: "tool",
        id: nextId("tool"),
        anchorId: state.anchorId,
        toolId: event.params.toolId,
        toolName: event.params.toolName,
        args: null,
        status: event.params.isError ? "error" : "ok",
        output: event.params.output,
        elapsed: event.params.elapsed,
      });
    }

    case "permission/request":
      return withItem(state, {
        kind: "permission",
        id: event.params.id,
        anchorId: state.anchorId,
        toolName: event.params.toolName,
        description: event.params.description,
        response: null,
      });

    case "question/ask":
      return withItem(state, {
        kind: "question",
        id: event.params.id,
        anchorId: state.anchorId,
        questions: event.params.questions ?? [],
        answered: false,
      });

    case "agent/loop_complete": {
      const next = settlePrompts(finalizeThinking(state));
      return notice(
        { ...next, streaming: false },
        "done",
        `Done in ${event.params.elapsed.toFixed(1)}s`,
      );
    }

    case "agent/usage":
      return { ...state, usage: event.params };

    case "agent/system":
      return notice(state, "info", event.params.message);

    case "agent/error":
      return notice(
        { ...settlePrompts(state), streaming: false },
        "error",
        event.params.message,
      );

    case "agent/compact":
      return notice(state, "info", `⟳ ${event.params.message}`);

    case "agent/retry":
      return notice(state, "info", `↻ Retrying: ${event.params.reason}`);

    case "session/context_cleared":
      return notice(
        state,
        "info",
        "Context cleared — Yukino starts fresh from here. Your history above is untouched.",
      );

    case "session/command_done":
      return { ...settlePrompts(state), streaming: false };

    default:
      return state;
  }
}

function handleFrame(raw: unknown) {
  if (typeof raw !== "string") return;
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof payload !== "object" || payload === null) return;
  const frame = payload as {
    jsonrpc?: unknown;
    id?: unknown;
    method?: unknown;
  };
  if (frame.jsonrpc !== "2.0" || "id" in frame) return;
  if (typeof frame.method !== "string") return;
  useAgentStore.setState((state) => apply(state, payload as AgentNotification));
}

function clearTimers() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function openSocket() {
  const { token } = useAuthStore.getState();
  if (!token) {
    useAgentStore.setState({ status: "idle" });
    return;
  }

  if (socket) {
    socket.onclose = null;
    socket.close();
  }

  const next = new WebSocket(
    `${wsUrl}/agent/ws?token=${encodeURIComponent(token)}`,
  );
  next.onopen = () => {
    reconnectDelay = INITIAL_RECONNECT_DELAY;
    useAgentStore.setState({ status: "connected" });
    pingTimer = setInterval(() => send({ method: "ping" }), PING_INTERVAL);
  };
  next.onmessage = (event: MessageEvent) => handleFrame(event.data);
  next.onclose = () => {
    socket = null;
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (intentionalClose) {
      useAgentStore.setState({ status: "idle" });
      return;
    }
    useAgentStore.setState({ status: "reconnecting" });
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      openSocket();
    }, reconnectDelay);
  };
  next.onerror = () => next.close();
  socket = next;
}

const useAgentStore = create<AgentState>(() => ({
  ...emptySnapshot,

  connect() {
    if (socket) return;
    intentionalClose = false;
    reconnectDelay = INITIAL_RECONNECT_DELAY;
    clearTimers();
    useAgentStore.setState({ ...emptySnapshot, status: "connecting" });
    openSocket();
  },

  disconnect() {
    intentionalClose = true;
    clearTimers();
    if (socket) {
      socket.onclose = null;
      socket.close();
      socket = null;
    }
    useAgentStore.setState({ ...emptySnapshot });
  },

  respondPermission(id, response) {
    send({ method: "permission/respond", params: { id, response } });
    useAgentStore.setState((state) => ({
      items: state.items.map((item) =>
        item.kind === "permission" && item.id === id
          ? { ...item, response }
          : item,
      ),
    }));
  },

  answerQuestions(id, answers) {
    send({ method: "question/respond", params: { id, answers } });
    useAgentStore.setState((state) => ({
      items: state.items.map((item) =>
        item.kind === "question" && item.id === id
          ? { ...item, answered: true }
          : item,
      ),
    }));
  },

  stop() {
    send({ method: "session/cancel" });
  },
}));

export default useAgentStore;
