import { env } from "../config/env.js";
import type {
  PermissionDecision,
  PermissionRequestParams,
  QuestionRequestParams,
} from "./rpc-protocol.js";

type PermissionResolver = (decision: PermissionDecision) => void;
type QuestionResolver = (answers: Record<string, string>) => void;

interface PendingPermission {
  params: PermissionRequestParams;
  resolve: PermissionResolver;
  timer: NodeJS.Timeout;
}

interface PendingQuestion {
  params: QuestionRequestParams;
  resolve: QuestionResolver;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

// Pairs permission/question prompts with in-memory promises. Every prompt
// fails closed after a timeout (permissions → deny, questions → reject) and
// on cancellation, mirroring the Go bridge and the demo interaction broker.
export class InteractionBroker {
  private permissions = new Map<string, PendingPermission>();
  private questions = new Map<string, PendingQuestion>();

  requestPermission(params: PermissionRequestParams): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.permissions.delete(params.id);
        resolve("deny");
      }, env.AGENT_INTERACTION_TIMEOUT_MS);
      this.permissions.set(params.id, { params, resolve, timer });
    });
  }

  requestAnswers(params: QuestionRequestParams): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.questions.delete(params.id);
        reject(new Error("question timed out"));
      }, env.AGENT_INTERACTION_TIMEOUT_MS);
      this.questions.set(params.id, { params, resolve, reject, timer });
    });
  }

  // Returns false for unknown/expired ids so the WS route can answer
  // {applied: false}, like the Go bridge.
  resolvePermission(id: string, decision: PermissionDecision): boolean {
    const pending = this.permissions.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.permissions.delete(id);
    pending.resolve(decision);
    return true;
  }

  resolveQuestion(id: string, answers: Record<string, string>): boolean {
    const pending = this.questions.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.questions.delete(id);
    pending.resolve(answers);
    return true;
  }

  // Pending prompts a reconnecting client must still see.
  snapshot(): { permissions: PermissionRequestParams[]; questions: QuestionRequestParams[] } {
    return {
      permissions: [...this.permissions.values()].map((p) => p.params),
      questions: [...this.questions.values()].map((p) => p.params),
    };
  }

  hasPending(): boolean {
    return this.permissions.size > 0 || this.questions.size > 0;
  }

  // Fail-closed: denies every pending permission and rejects every pending
  // question. Used by cancel and dispose.
  cancelAll(reason = "cancelled") {
    for (const [id, p] of this.permissions) {
      clearTimeout(p.timer);
      p.resolve("deny");
      this.permissions.delete(id);
    }
    for (const [id, q] of this.questions) {
      clearTimeout(q.timer);
      q.reject(new Error(reason));
      this.questions.delete(id);
    }
  }
}
