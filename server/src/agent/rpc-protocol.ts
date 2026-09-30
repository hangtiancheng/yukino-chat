import { z } from "zod";

// JSON-RPC 2.0 vocabulary of the /agent/ws bridge, mirroring the Go bridge
// protocol (yukino/bridge/protocol.go).

export interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcSuccess {
  jsonrpc: "2.0";
  id: number | string | null;
  result: Record<string, unknown>;
}

export interface RpcError {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

export type RpcResponse = RpcSuccess | RpcError;

export const rpcNotification = (
  method: string,
  params?: Record<string, unknown>,
): RpcNotification => ({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });

export const rpcSuccess = (
  id: number | string | null,
  result: Record<string, unknown> = {},
): RpcSuccess => ({ jsonrpc: "2.0", id, result });

export const rpcError = (id: number | string | null, code: number, message: string): RpcError => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

export const ERROR_METHOD_NOT_FOUND = -32601;

export const permissionResponseSchema = z.object({
  id: z.string(),
  response: z.enum(["allow", "deny", "allowAlways"]),
});

export const questionResponseSchema = z.object({
  id: z.string(),
  answers: z.record(z.string(), z.string()),
});

export const cancelSchema = z.object({}).loose();

export type PermissionDecision = "allow" | "deny" | "allowAlways";

export interface PermissionRequestParams {
  id: string;
  toolName: string;
  description: string;
}

export interface QuestionRequestParams {
  id: string;
  questions: {
    question: string;
    header: string;
    options: { label: string; description?: string }[];
    multiSelect: boolean;
  }[];
}

export const SERVER_COMMANDS = [
  { name: "help", description: "Show available commands" },
  { name: "clear", description: "Clear conversation context" },
  { name: "compact", description: "Force context compaction" },
  { name: "plan", description: "Toggle plan mode (read-only)" },
];
