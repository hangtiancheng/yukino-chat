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
import { useLocation, useNavigate } from "react-router-dom";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
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
                  ? "text-primary hover:text-primary"
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
        "flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors",
        active ? "text-primary" : "text-muted-foreground active:text-foreground",
      )}
    >
      <Icon className="size-5" />
      <span className="max-w-full truncate text-[10px] font-medium leading-none">
        {label}
      </span>
    </button>
  );
}

export function NavBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
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
      <nav className="border-border bg-muted/50 hidden h-full w-16 shrink-0 flex-col items-center border-r py-4 md:flex">
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
          <RailButton
            label={isDark ? "Light mode" : "Dark mode"}
            icon={isDark ? Sun : Moon}
            onClick={() => setTheme(isDark ? "light" : "dark")}
          />
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
      <nav className="border-border bg-muted/50 order-last flex shrink-0 items-stretch border-t safe-px h-[calc(3.5rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] md:hidden">
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
                  "flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors",
                  "text-muted-foreground active:text-foreground",
                )}
              />
            }
          >
            <MoreHorizontal className="size-5" />
            <span className="text-[10px] font-medium leading-none">More</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="mb-1 w-52">
            <DropdownMenuLabel>{userInfo.nickname}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => togglePalette()}>
              <Search className="size-4" />
              Search
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme(isDark ? "light" : "dark")}>
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
              {isDark ? "Light mode" : "Dark mode"}
            </DropdownMenuItem>
            {isAdmin && (
              <DropdownMenuItem onClick={() => navigate("/dashboard")}>
                <ChartBar className="size-4" />
                Cache Dashboard
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
              <LogOut className="size-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </>
  );
}
