import {
  ChartBar,
  LogOut,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Search,
  Settings,
  Sun,
  User,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTheme } from "@/store/theme";
import { useLocation, useMatch, useNavigate } from "react-router-dom";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import useAuthStore from "@/store/auth";
import useUiStore from "@/store/ui";
import { performLogout } from "@/utils/logout";

interface RailItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

const NAV_ITEMS: RailItem[] = [
  { label: "Sessions", path: "/chat/sessions", icon: MessageSquare },
  { label: "Contacts", path: "/chat/contacts", icon: Users },
  { label: "Profile", path: "/chat/profile", icon: User },
];

function activeSection(pathname: string): string {
  if (pathname.startsWith("/chat/contacts")) return "/chat/contacts";
  if (pathname.startsWith("/chat/profile")) return "/chat/profile";
  if (pathname.startsWith("/chat")) return "/chat/sessions";
  return pathname;
}

interface RailButtonProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  destructive?: boolean;
}

function RailButton({
  label,
  icon: Icon,
  onClick,
  active,
  destructive,
}: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-current={active ? "page" : undefined}
            onClick={onClick}
            className={cn(
              "relative transition-colors duration-200",
              destructive
                ? "text-destructive hover:bg-destructive/10 hover:text-destructive"
                : active
                  ? "text-primary-ink hover:text-primary-ink"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          />
        }
      >
        {active && (
          <motion.span
            layoutId="nav-active-section"
            className="bg-primary/12 absolute inset-0 rounded-md"
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          />
        )}
        <Icon className="relative size-5" />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

interface MobileTabProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
}

function MobileTab({ label, icon: Icon, onClick, active }: MobileTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-visible:ring-ring relative flex min-h-14 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 px-1 py-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset",
        active
          ? "text-primary-ink"
          : "text-muted-foreground active:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex h-6 w-12 items-center justify-center rounded-full transition-colors",
          active && "bg-primary/12",
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="max-w-full truncate text-[11px] leading-none font-medium">
        {label}
      </span>
    </button>
  );
}

export function NavBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const chatRoute = useMatch("/chat/:id");
  const isConversation = Boolean(
    chatRoute &&
    !["sessions", "contacts", "profile"].includes(chatRoute.params.id ?? ""),
  );
  const userInfo = useAuthStore((state) => state.userInfo);
  const { resolvedTheme, setTheme } = useTheme();
  const togglePalette = useUiStore((state) => state.togglePalette);

  const current = activeSection(pathname);
  const isDark = resolvedTheme === "dark";
  const isAdmin = userInfo.is_admin === 1;

  const signOut = async () => {
    await performLogout();
    navigate("/login");
  };

  return (
    <>
      {/* Desktop: vertical rail on the left. */}
      <nav
        aria-label="Main navigation"
        className="border-border bg-sidebar hidden h-full w-16 shrink-0 flex-col items-center border-r py-4 md:flex"
      >
        <Avatar className="ring-primary/30 ring-offset-card size-10 ring-2 ring-offset-2 transition-transform duration-200 hover:scale-105">
          <AvatarImage src={userInfo.avatar} alt={userInfo.nickname} />
          <AvatarFallback>
            {userInfo.nickname.charAt(0).toUpperCase() || "U"}
          </AvatarFallback>
        </Avatar>

        <div className="mt-6 flex flex-col items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <RailButton
              key={item.path}
              label={item.label}
              icon={item.icon}
              active={current === item.path}
              onClick={() => navigate(item.path)}
            />
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex flex-col items-center gap-1">
          <div className="bg-border mb-2 h-px w-8" aria-hidden="true" />
          <ThemeToggle />
          {isAdmin && (
            <RailButton
              label="Admin"
              icon={Settings}
              active={current === "/manager"}
              onClick={() => navigate("/manager")}
            />
          )}
          <RailButton
            label="Sign Out"
            icon={LogOut}
            onClick={signOut}
            destructive
          />
        </div>
      </nav>

      {/* Mobile: bottom tab bar with safe-area padding. */}
      <nav
        aria-label="Main navigation"
        className={cn(
          "border-border bg-card order-last flex shrink-0 items-stretch border-t pb-[env(safe-area-inset-bottom)] md:hidden",
          isConversation && "hidden",
        )}
      >
        {NAV_ITEMS.map((item) => (
          <MobileTab
            key={item.path}
            label={item.label}
            icon={item.icon}
            active={current === item.path}
            onClick={() => navigate(item.path)}
          />
        ))}
        {isAdmin && (
          <MobileTab
            label="Admin"
            icon={Settings}
            active={current === "/manager"}
            onClick={() => navigate("/manager")}
          />
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="More options"
                aria-current={undefined}
                className={cn(
                  "focus-visible:ring-ring flex min-h-14 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 px-1 py-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset",
                  "text-muted-foreground active:text-foreground",
                )}
              />
            }
          >
            <span className="flex h-6 items-center">
              <MoreHorizontal className="size-5" />
            </span>
            <span className="text-[11px] leading-none font-medium">More</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="mb-1 w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{userInfo.nickname}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => togglePalette()}>
                <Search className="size-4" />
                Search
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTheme(isDark ? "light" : "dark")}
              >
                {isDark ? (
                  <Sun className="size-4" />
                ) : (
                  <Moon className="size-4" />
                )}
                {isDark ? "Light mode" : "Dark mode"}
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem onClick={() => navigate("/dashboard")}>
                  <ChartBar className="size-4" />
                  Cache Dashboard
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void signOut()}
              >
                <LogOut className="size-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </>
  );
}
