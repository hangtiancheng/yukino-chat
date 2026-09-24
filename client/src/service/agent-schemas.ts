/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * Wire shapes for the Yukino control socket, plus the timeline model built from
 * them.
 *
 * The socket speaks JSON-RPC 2.0: agent progress arrives as server-to-client
 * notifications (no id), and the client's control messages are requests (with
 * an id) that the server answers with a result or a protocol error.
 *
 * The assistant's finished text arrives as ordinary chat messages, so this
 * socket only carries what a transcript cannot hold: token deltas, thinking,
 * tool calls and the prompts a run blocks on. Each of those is anchored to the
 * chat message it followed, which is what lets tool cards sit between two
 * replies instead of piling up at the end.
 */

/* Server → client */

export interface AgentConnected {
  model: string;
  streaming: boolean;
  /** False while the agent is still warming up: MCP servers, tools, context. */
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

/** Tool arguments are opaque agent JSON; only a few known keys are previewed. */
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

/** One server-to-client JSON-RPC notification. Members without a declared
 * `params` arrive without the member; unknown methods are ignored. */
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

/* Client → server */

export type PermissionResponse = "allow" | "deny" | "allowAlways";

/** One client-to-server JSON-RPC request; the store adds `jsonrpc` and a
 * numeric `id` when sending and treats the answer as fire-and-forget. */
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

/* Timeline model */

export type AgentConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting";

export type ToolStatus = "running" | "ok" | "error";

/** Every item remembers the chat message it came after, so the transcript and
 * this overlay stay interleaved in the order things actually happened. */
interface Anchored {
  id: string;
  anchorId: string;
}

export interface AgentStreamItem extends Anchored {
  kind: "stream";
  content: string;
  streaming: boolean;
  /** Once set, the chat message with this uuid replaces the live bubble. */
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

/** tool_use and tool_result are matched on this pair, not on arrival order. */
export const toolKey = (toolName: string, toolId: string) => `${toolName}_${toolId}`;
