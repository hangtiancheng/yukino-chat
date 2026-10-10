export interface AgentConnected {
  model: string;
  streaming: boolean;
  ready: boolean;
  anchorId: string;
  inputTokens: number;
  outputTokens: number;
  permissionMode: string;
}

export interface SlashCommand {
  name: string;
  description: string;
}

export type ToolArgs = Record<string, unknown> | null;

export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export type AgentNotification =
  | { method: "session/connected"; params: AgentConnected }
  | { method: "session/ready" }
  | { method: "session/commands"; params?: SlashCommand[] | null }
  | { method: "session/context_cleared" }
  | { method: "session/command_done" }
  | { method: "agent/run_start"; params: { userMessageId: string } }
  | { method: "agent/stream_text"; params: { text: string } }
  | {
      method: "agent/stream_end";
      params: { text: string; messageId: string };
    }
  | { method: "agent/thinking_text"; params: { text: string } }
  | {
      method: "agent/thinking_complete";
      params: { thinking: string; signature: string };
    }
  | {
      method: "agent/tool_use";
      params: { toolId: string; toolName: string; args: ToolArgs };
    }
  | {
      method: "agent/tool_result";
      params: {
        toolId: string;
        toolName: string;
        output: string;
        isError: boolean;
        elapsed: number;
      };
    }
  | { method: "agent/turn_complete"; params: { turn: number } }
  | {
      method: "agent/loop_complete";
      params: { totalTurns: number; elapsed: number; stopReason?: string };
    }
  | {
      method: "agent/usage";
      params: { inputTokens: number; outputTokens: number };
    }
  | { method: "agent/system"; params: { message: string } }
  | { method: "agent/error"; params: { message: string } }
  | { method: "agent/compact"; params: { message: string } }
  | { method: "agent/retry"; params: { reason: string; waitMs: number } }
  | {
      method: "permission/request";
      params: { id: string; toolName: string; description: string };
    }
  | { method: "question/ask"; params: { id: string; questions: Question[] } };

export type PermissionResponse = "allow" | "deny" | "allowAlways";

export type AgentRequest =
  | {
      method: "permission/respond";
      params: { id: string; response: PermissionResponse };
    }
  | {
      method: "question/respond";
      params: { id: string; answers: Record<string, string> };
    }
  | { method: "session/cancel" }
  | { method: "ping" };

export type AgentConnectionStatus =
  "idle" | "connecting" | "connected" | "reconnecting";

export type ToolStatus = "running" | "ok" | "error";

interface Anchored {
  id: string;
  anchorId: string;
}

export interface AgentStreamItem extends Anchored {
  kind: "stream";
  content: string;
  streaming: boolean;
  messageId: string;
}

export interface AgentThinkingItem extends Anchored {
  kind: "thinking";
  content: string;
  done: boolean;
}

export interface AgentToolItem extends Anchored {
  kind: "tool";
  toolId: string;
  toolName: string;
  args: ToolArgs;
  status: ToolStatus;
  output: string;
  elapsed: number;
}

export interface AgentPermissionItem extends Anchored {
  kind: "permission";
  toolName: string;
  description: string;
  response: PermissionResponse | null;
}

export interface AgentQuestionItem extends Anchored {
  kind: "question";
  questions: Question[];
  answered: boolean;
}

export interface AgentNoticeItem extends Anchored {
  kind: "notice";
  tone: "info" | "error" | "done";
  content: string;
}

export type AgentItem =
  | AgentStreamItem
  | AgentThinkingItem
  | AgentToolItem
  | AgentPermissionItem
  | AgentQuestionItem
  | AgentNoticeItem;

export const toolKey = (toolName: string, toolId: string) =>
  `${toolName}_${toolId}`;
