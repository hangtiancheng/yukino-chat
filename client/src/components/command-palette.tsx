import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { MessageSquare, Settings, User, Users, X } from "lucide-react";
import { useHotkeys } from "react-hotkeys-hook";
import { useNavigate } from "react-router-dom";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  friendsQuery,
  groupSessionsQuery,
  userSessionsQuery,
} from "@/service/queries";
import useAuthStore from "@/store/auth";
import useUiStore from "@/store/ui";

const itemClass =
  "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm";

const groupClass =
  "[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium";

export function CommandPalette() {
  const open = useUiStore((state) => state.paletteOpen);
  const setOpen = useUiStore((state) => state.setPaletteOpen);
  const navigate = useNavigate();
  const userId = useAuthStore((state) => state.userInfo.uuid);
  const isAdmin = useAuthStore((state) => state.userInfo.is_admin === 1);

  useHotkeys("mod+k", () => useUiStore.getState().togglePalette(), {
    preventDefault: true,
    enableOnFormTags: true,
  });

  const enabled = open && Boolean(userId);
  const { data: userSessions = [] } = useQuery({
    ...userSessionsQuery(userId),
    enabled,
  });
  const { data: groupSessions = [] } = useQuery({
    ...groupSessionsQuery(userId),
    enabled,
  });
  const { data: friends = [] } = useQuery({
    ...friendsQuery(userId),
    enabled,
  });

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Search conversations and contacts"
      loop
      overlayClassName="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0"
      contentClassName="bg-popover text-popover-foreground border-border data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed z-50 flex max-h-[var(--app-height,100dvh)] w-full flex-col overflow-hidden border shadow-2xl safe-pt inset-x-0 top-[var(--app-offset-top,0px)] translate-x-0 rounded-none rounded-b-2xl data-[state=open]:slide-in-from-top sm:inset-x-auto sm:top-[calc(var(--app-offset-top,0px)+2rem)] sm:left-1/2 sm:max-h-[calc(var(--app-height,100dvh)-4rem)] sm:max-w-lg sm:-translate-x-1/2 sm:rounded-xl sm:data-[state=open]:slide-in-from-top-0 sm:data-[state=open]:zoom-in-95"
    >
      <div className="border-border flex shrink-0 items-center gap-1 border-b pr-2">
        <Command.Input
          placeholder="Jump to a conversation, contact or page…"
          className="placeholder:text-muted-foreground/60 min-w-0 flex-1 bg-transparent px-4 py-4 text-base outline-none md:text-sm"
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close search"
          className="size-11 md:size-8"
          onClick={() => setOpen(false)}
        >
          <X className="size-4" />
        </Button>
      </div>
      <Command.List className="max-h-[60dvh] min-h-0 overflow-y-auto overscroll-contain p-2 sm:max-h-80">
        <Command.Empty className="text-muted-foreground py-6 text-center text-sm">
          No results found
        </Command.Empty>

        <Command.Group heading="Go to" className={groupClass}>
          <Command.Item
            className={itemClass}
            onSelect={() => go("/chat/sessions")}
          >
            <MessageSquare className="size-4" />
            Sessions
          </Command.Item>
          <Command.Item
            className={itemClass}
            onSelect={() => go("/chat/contacts")}
          >
            <Users className="size-4" />
            Contacts
          </Command.Item>
          <Command.Item
            className={itemClass}
            onSelect={() => go("/chat/profile")}
          >
            <User className="size-4" />
            My Profile
          </Command.Item>
          {isAdmin && (
            <Command.Item className={itemClass} onSelect={() => go("/manager")}>
              <Settings className="size-4" />
              Admin
            </Command.Item>
          )}
        </Command.Group>

        {[
          { heading: "Conversations", rows: userSessions },
          { heading: "Groups", rows: groupSessions },
        ].map(({ heading, rows }) =>
          rows.length === 0 ? null : (
            <Command.Group
              key={heading}
              heading={heading}
              className={groupClass}
            >
              {rows.map((row) => (
                <Command.Item
                  key={row.id}
                  value={`${row.name} ${row.id}`}
                  className={itemClass}
                  onSelect={() => go(`/chat/${row.id}`)}
                >
                  <Avatar className="size-6">
                    <AvatarImage src={row.avatar} alt={row.name} />
                    <AvatarFallback className="text-[10px]">
                      {row.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{row.name}</span>
                  {row.unreadCount > 0 && (
                    <span className="text-muted-foreground ml-auto text-xs">
                      {row.unreadCount} unread
                    </span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          ),
        )}

        {friends.length > 0 && (
          <Command.Group heading="Contacts" className={groupClass}>
            {friends.map((friend) => (
              <Command.Item
                key={friend.user_id}
                value={`${friend.note_name || friend.nickname} ${friend.user_id}`}
                className={itemClass}
                onSelect={() => go(`/chat/${friend.user_id}`)}
              >
                <Avatar className="size-6">
                  <AvatarImage src={friend.avatar} alt={friend.nickname} />
                  <AvatarFallback className="text-[10px]">
                    {friend.nickname.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">
                  {friend.note_name || friend.nickname}
                </span>
                {friend.online && (
                  <span className="ml-auto size-2 rounded-full bg-emerald-500" />
                )}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
