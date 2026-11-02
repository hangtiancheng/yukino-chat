import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";

import { cn } from "@/lib/utils";

const plugins = { cjk, code, math, mermaid };

interface MessageContentProps {
  content: string;
  className?: string;
}

export function MessageContent({ content, className }: MessageContentProps) {
  return (
    <Streamdown
      mode="static"
      animated={false}
      parseIncompleteMarkdown={false}
      plugins={plugins}
      className={cn(
        "max-w-full min-w-0 space-y-2 text-sm leading-relaxed wrap-anywhere **:data-[streamdown=link]:text-[color:var(--message-link-color,var(--primary-ink))] [&_pre]:max-w-full [&_pre]:overflow-x-auto",
        className,
      )}
    >
      {content}
    </Streamdown>
  );
}
