import { Outlet } from "react-router-dom";

import { CallDialog } from "@/components/call-dialog";
import { CommandPalette } from "@/components/command-palette";
import { NavBar } from "@/components/nav-bar";
import { Card } from "@/components/ui/card";

export function AppShell() {
  return (
    <div className="bg-background h-dvh">
      <Card className="size-full flex-row gap-0 overflow-hidden rounded-none border-none p-0 shadow-none">
        <NavBar />
        <Outlet />
      </Card>
      <CommandPalette />
      <CallDialog />
    </div>
  );
}
