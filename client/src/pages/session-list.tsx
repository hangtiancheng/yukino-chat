import { MessageSquare } from "lucide-react";

import { SessionSidebar } from "@/components/session-sidebar";

export default function SessionList() {
  return (
    <>
      {/* Full-width list on mobile; fixed rail beside the conversation on md+. */}
      <div className="border-border bg-card min-h-0 w-full min-w-0 flex-1 overflow-hidden md:w-64 md:flex-none md:border-r lg:w-80">
        <SessionSidebar />
      </div>
      <div className="text-muted-foreground/50 hidden flex-1 flex-col items-center justify-center md:flex">
        <span className="bg-primary/8 text-primary-ink/60 mb-5 flex size-24 items-center justify-center rounded-3xl">
          <MessageSquare size={40} strokeWidth={1.5} />
        </span>
        <h1 className="text-foreground mb-2 text-xl font-semibold">
          Your conversations, together
        </h1>
        <p className="text-muted-foreground/70">
          Select a conversation to start chatting
        </p>
        <p className="text-muted-foreground/50 mt-2 text-xs">
          Press ⌘K to jump to anyone
        </p>
      </div>
    </>
  );
}
