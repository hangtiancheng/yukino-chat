import NumberFlow from "@number-flow/react";
import { useQuery } from "@tanstack/react-query";
import { Bot, ChevronDown, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { groupSessionsQuery, userSessionsQuery } from "@/service/queries";
import { isYukino, MessageType, type ChatSession } from "@/service/schemas";
import useAuthStore from "@/store/auth";
import { formatSessionTime } from "@/utils/format";

const PREVIEW_BY_TYPE: Record<number, string> = {
  [MessageType.Image]: "[Image]",
  [MessageType.File]: "[File]",
  [MessageType.AvSignal]: "[Call]",
  [MessageType.Video]: "[Video]",
};

function previewOf(session: ChatSession): string {
  return PREVIEW_BY_TYPE[session.lastMessageType] ?? session.lastMessage;
}

interface SessionRowProps {
  session: ChatSession;
  active: boolean;
  onSelect: () => void;
}

function SessionRow({ session, active, onSelect }: SessionRowProps) {
  const preview = previewOf(session);
  return (
    <motion.button
      type="button"
      layout="position"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onSelect}
      className={cn(
        "hover:bg-accent/60 active:bg-accent focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset md:gap-2.5 md:py-2.5",
        active && "bg-accent/80",
      )}
    >
      <Avatar className="size-12 shrink-0 rounded-2xl md:size-10 md:rounded-xl">
        <AvatarImage src={session.avatar} alt={session.name} />
        <AvatarFallback className="text-xs">
          {session.name.charAt(0).toUpperCase() || "?"}
        </AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-foreground flex min-w-0 items-center gap-1 text-base font-medium md:text-sm">
            {isYukino(session.id) && (
              <Bot className="text-primary-ink size-3.5 shrink-0" />
            )}
            <span className="truncate">{session.name}</span>
          </span>
          <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
            {formatSessionTime(session.lastMessageAtMs)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-muted-foreground truncate text-sm md:text-xs">
            {preview || "No messages yet"}
          </span>
          {session.unreadCount > 0 && (
            <span
              aria-label={`${session.unreadCount} unread messages`}
              className="bg-primary text-primary-foreground flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-medium tabular-nums"
            >
              <NumberFlow value={Math.min(session.unreadCount, 99)} />
              {session.unreadCount > 99 && "+"}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}

interface SessionSectionProps {
  title: string;
  open: boolean;
  isLoading: boolean;
  filtered: boolean;
  sessions: ChatSession[];
  activeId: string | undefined;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
}

function SessionSection({
  title,
  open,
  isLoading,
  filtered,
  sessions,
  activeId,
  onOpenChange,
  onSelect,
}: SessionSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger
        className="hover:bg-accent/50 focus-visible:ring-ring flex min-h-11 w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset"
        aria-label={`${title} (${sessions.length})`}
      >
        <span className="text-foreground text-sm font-medium">
          {title}
          <span className="text-muted-foreground ml-2 text-xs font-normal tabular-nums">
            <NumberFlow value={sessions.length} />
          </span>
        </span>
        <ChevronDown
          className={cn(
            "text-muted-foreground size-4 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden pb-2">
        {isLoading ? (
          <p className="text-muted-foreground animate-pulse px-3 py-3 text-xs">
            Loading sessions…
          </p>
        ) : sessions.length === 0 ? (
          <p className="text-muted-foreground px-3 py-3 text-xs">
            {filtered ? "No matches found" : "No sessions yet"}
          </p>
        ) : (
          <AnimatePresence initial={false}>
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === activeId}
                onSelect={() => onSelect(session.id)}
              />
            ))}
          </AnimatePresence>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SessionSidebar() {
  const navigate = useNavigate();
  const { id: activeId } = useParams<{ id: string }>();
  const userId = useAuthStore((state) => state.userInfo.uuid);

  const [query, setQuery] = useState("");
  const [usersOpen, setUsersOpen] = useState(true);
  const [groupsOpen, setGroupsOpen] = useState(false);

  const users = useQuery(userSessionsQuery(userId));
  const groups = useQuery({
    ...groupSessionsQuery(userId),
    enabled: groupsOpen && Boolean(userId),
  });

  const needle = query.trim().toLowerCase();
  const matching = (sessions: ChatSession[] | undefined) => {
    const rows = sessions ?? [];
    return needle
      ? rows.filter((row) => row.name.toLowerCase().includes(needle))
      : rows;
  };

  const openChat = (id: string) => navigate(`/chat/${id}`);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="shrink-0 px-4 pt-5 pb-3 md:pt-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Messages</h1>
            <p className="text-muted-foreground mt-1 text-xs">
              A little closer, wherever you are.
            </p>
          </div>
          <ThemeToggle className="size-11 md:hidden" />
        </div>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            className="bg-muted/50 rounded-xl border-transparent pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        <SessionSection
          title="Direct messages"
          open={usersOpen}
          isLoading={users.isPending}
          filtered={Boolean(needle)}
          sessions={matching(users.data)}
          activeId={activeId}
          onOpenChange={setUsersOpen}
          onSelect={openChat}
        />
        <SessionSection
          title="Groups"
          open={groupsOpen}
          isLoading={groupsOpen && groups.isPending}
          filtered={Boolean(needle)}
          sessions={matching(groups.data)}
          activeId={activeId}
          onOpenChange={setGroupsOpen}
          onSelect={openChat}
        />
      </div>
    </div>
  );
}
