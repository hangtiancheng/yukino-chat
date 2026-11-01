import { Outlet } from "react-router-dom";

import { CallDialog } from "@/components/call-dialog";
import { CommandPalette } from "@/components/command-palette";
import { NavBar } from "@/components/nav-bar";
import { Card } from "@/components/ui/card";

export function AppShell() {
  return (
    // safe-pt keeps content clear of the iOS notch in standalone PWA mode; it
    // resolves to 0 in a normal browser, so desktop is unaffected.
    <div className="bg-background safe-pt h-dvh">
      {/* Mobile stacks the nav below the content (order-last on the bottom
          bar); desktop lays the rail out to the left. */}
      <Card className="size-full flex-col gap-0 overflow-hidden rounded-none border-none p-0 shadow-none md:flex-row">
        <NavBar />
        <Outlet />
      </Card>
      <CommandPalette />
      <CallDialog />
    </div>
  );
}
