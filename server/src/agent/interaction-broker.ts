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
  /** Detaches the abort listener once the request settles by any path. */
  off?: () => void;
}

interface PendingQuestion {
  params: QuestionRequestParams;
  resolve: QuestionResolver;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class InteractionBroker {
  private permissions = new Map<string, PendingPermission>();
  private questions = new Map<string, PendingQuestion>();

  /**
   * Registers a permission prompt and returns its decision. The optional
   * abort signal mirrors the remote server: when the owning tool call or run
   * is cancelled library-side, the prompt settles (deny) immediately instead
   * of pinning the run until the interaction timeout.
   */
  requestPermission(
    params: PermissionRequestParams,
    signal?: AbortSignal,
  ): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.settlePermission(params.id, "deny");
      }, env.AGENT_INTERACTION_TIMEOUT_MS);
      const onAbort = () => {
        this.settlePermission(params.id, "deny");
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const off = () => signal?.removeEventListener("abort", onAbort);
      this.permissions.set(params.id, { params, resolve, timer, off });
      if (signal?.aborted) onAbort();
    });
  }

  /** Resolves a pending permission exactly once, clearing timer + listener. */
  private settlePermission(id: string, decision: PermissionDecision): boolean {
    const pending = this.permissions.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    pending.off?.();
    this.permissions.delete(id);
    pending.resolve(decision);
    return true;
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

  resolvePermission(id: string, decision: PermissionDecision): boolean {
    return this.settlePermission(id, decision);
  }

  resolveQuestion(id: string, answers: Record<string, string>): boolean {
    const pending = this.questions.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.questions.delete(id);
    pending.resolve(answers);
    return true;
  }

  snapshot(): { permissions: PermissionRequestParams[]; questions: QuestionRequestParams[] } {
    return {
      permissions: [...this.permissions.values()].map((p) => p.params),
      questions: [...this.questions.values()].map((p) => p.params),
    };
  }

  hasPending(): boolean {
    return this.permissions.size > 0 || this.questions.size > 0;
  }

  cancelAll(reason = "cancelled") {
    for (const id of [...this.permissions.keys()]) {
      this.settlePermission(id, "deny");
    }
    for (const [id, q] of this.questions) {
      clearTimeout(q.timer);
      q.reject(new Error(reason));
      this.questions.delete(id);
    }
  }
}
