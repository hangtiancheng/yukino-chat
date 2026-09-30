import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import useAgentStore from "@/store/agent";
import { formatTokens } from "@/utils/format";

const DOT_CLASS = {
  idle: "bg-muted-foreground",
  connecting: "bg-amber-500 animate-pulse",
  connected: "bg-emerald-500",
  reconnecting: "bg-amber-500 animate-pulse",
} as const;

const DOT_LABEL = {
  idle: "Assistant offline",
  connecting: "Connecting to Yukino…",
  connected: "Yukino connected",
  reconnecting: "Reconnecting to Yukino…",
} as const;

/** Header strip for the assistant thread: link health, model and token spend. */
export function AgentStatus() {
  const status = useAgentStore((state) => state.status);
  const ready = useAgentStore((state) => state.ready);
  const model = useAgentStore((state) => state.model);
  const usage = useAgentStore((state) => state.usage);

  // Warming up can take a while when MCP servers are configured, and a prompt
  // sent meanwhile just waits its turn — so say so rather than showing a
  // healthy dot the agent cannot live up to yet.
  const warming = status === "connected" && !ready;
  const dotClass = warming ? "bg-amber-500 animate-pulse" : DOT_CLASS[status];
  const label = warming ? "Yukino is starting up…" : DOT_LABEL[status];

  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      {usage && (
        <span className="tabular-nums" title="Tokens in / out">
          {formatTokens(usage.inputTokens)}↑ {formatTokens(usage.outputTokens)}↓
        </span>
      )}
      {model && <span className="hidden font-mono sm:inline">{model}</span>}
      <Tooltip>
        <TooltipTrigger
          render={<span aria-label={label} className={cn("size-2 rounded-full", dotClass)} />}
        />
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </div>
  );
}
