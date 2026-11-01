import { MessageSquare } from "lucide-react";

import { SessionSidebar } from "@/components/session-sidebar";

export default function SessionList() {
  return (
    <>
      {/* Full-width list on mobile; fixed rail beside the conversation on md+. */}
      <div className="border-border w-full flex-1 border-r md:w-55 md:flex-none">
        <SessionSidebar />
      </div>
      <div className="text-muted-foreground/50 hidden flex-1 flex-col items-center justify-center md:flex">
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
