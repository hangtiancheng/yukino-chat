import type { Agent } from "@yukino.js/yukino";

type AgentEvent = Agent.Events.AgentEvent;

export type AdapterAction =
  | { kind: "notify"; method: string; params: Record<string, unknown> }
  | { kind: "flush" };

export class EventAdapter {
  private streamText = "";
  turns = 0;
  completed = false;
  cancelRequested = false;

  private readonly elapsedSeconds: () => number;

  constructor(elapsedSeconds: () => number) {
    this.elapsedSeconds = elapsedSeconds;
  }

  takeStreamText(): string {
    const text = this.streamText.trim();
    this.streamText = "";
    return text;
  }

  map(event: AgentEvent): AdapterAction[] {
    switch (event.type) {
      case "stream_text":
        this.streamText += event.text;
        return [{ kind: "notify", method: "agent/stream_text", params: { text: event.text } }];
      case "thinking_text":
        return [{ kind: "notify", method: "agent/thinking_text", params: { text: event.text } }];
      case "thinking_complete":
        return [
          {
            kind: "notify",
            method: "agent/thinking_complete",
            params: { thinking: event.thinking, signature: event.signature },
          },
        ];
      case "tool_use":
        return [
          { kind: "flush" },
          {
            kind: "notify",
            method: "agent/tool_use",
            params: { toolId: event.toolId, toolName: event.toolName, args: event.args },
          },
        ];
      case "tool_result":
        return [
          {
            kind: "notify",
            method: "agent/tool_result",
            params: {
              toolId: event.toolId,
              toolName: event.toolName,
              output: event.output,
              isError: event.isError,
              elapsed: event.elapsed,
            },
          },
        ];
      case "turn_complete": {
        this.turns++;
        return [
          { kind: "flush" },
          { kind: "notify", method: "agent/turn_complete", params: { turn: this.turns } },
        ];
      }
      case "loop_complete": {
        this.completed = true;
        return [
          { kind: "flush" },
          {
            kind: "notify",
            method: "agent/loop_complete",
            params: {
              totalTurns: this.turns,
              elapsed: this.elapsedSeconds(),
              stopReason: event.stopReason,
            },
          },
        ];
      }
      case "usage":
        return [
          {
            kind: "notify",
            method: "agent/usage",
            params: {
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
            },
          },
        ];
      case "error":
        if (this.cancelRequested) return [];
        return [
          { kind: "notify", method: "agent/error", params: { message: event.error.message } },
        ];
      case "compact":
        return [{ kind: "notify", method: "agent/compact", params: { message: event.message } }];
      case "retry":
        return [
          {
            kind: "notify",
            method: "agent/retry",
            params: { reason: event.reason, waitMs: event.delay },
          },
        ];
      case "permission_request":
        return [];
      default:
        return [];
    }
  }
}
