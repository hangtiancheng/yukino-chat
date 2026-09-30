import { ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AgentPermissionItem } from "@/service/agent-schemas";
import useAgentStore from "@/store/agent";

const RESULT_LABEL = {
  allow: "Allowed once",
  allowAlways: "Always allowed",
  deny: "Denied",
} as const;

/** Yukino blocks on this card: the tool call does not proceed until an answer
 * goes back, so the choices stay visible until one is picked. */
export function AgentPermissionCard({ item }: { item: AgentPermissionItem }) {
  const respondPermission = useAgentStore((state) => state.respondPermission);

  if (item.response) {
    return (
      <p className="text-muted-foreground text-xs">
        {RESULT_LABEL[item.response]} · {item.toolName}
      </p>
    );
  }

  return (
    <section
      aria-label={`Permission request for ${item.toolName}`}
      className="border-primary/30 bg-card max-w-[85%] rounded-lg border px-3 py-2.5 shadow-sm"
    >
      <div className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
        <ShieldQuestion className="text-primary size-3.5" />
        {item.toolName} needs permission
      </div>
      <p className="text-muted-foreground mt-1 text-xs wrap-break-word whitespace-pre-wrap">
        {item.description}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => respondPermission(item.id, "allow")}>
          Allow
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => respondPermission(item.id, "allowAlways")}
        >
          Always allow
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={() => respondPermission(item.id, "deny")}
        >
          Deny
        </Button>
      </div>
    </section>
  );
}
