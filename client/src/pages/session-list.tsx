import { MessageSquare } from "lucide-react";

import { SessionSidebar } from "@/components/session-sidebar";

export default function SessionList() {
  return (
    <>
      <div className="border-border w-55 shrink-0 border-r">
        <SessionSidebar />
      </div>
      <div className="text-muted-foreground/50 flex flex-1 flex-col items-center justify-center">
        <MessageSquare size={64} strokeWidth={1.5} className="mb-4" />
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
