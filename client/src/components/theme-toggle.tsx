import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTheme } from "@/store/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={isDark}
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className={cn("text-muted-foreground relative", className)}
          />
        }
      >
        <Sun
          data-theme-icon
          className={cn(
            "absolute size-5 transition-[transform,opacity] duration-300 motion-reduce:transition-none",
            isDark
              ? "scale-50 -rotate-90 opacity-0"
              : "scale-100 rotate-0 opacity-100",
          )}
        />
        <Moon
          data-theme-icon
          className={cn(
            "absolute size-5 transition-[transform,opacity] duration-300 motion-reduce:transition-none",
            isDark
              ? "scale-100 rotate-0 opacity-100"
              : "scale-50 rotate-90 opacity-0",
          )}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
