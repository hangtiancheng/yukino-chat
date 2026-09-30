import { enablePlugin, init } from "@yukino.js/sentry";
import { PerformancePlugin, ScreenRecordPlugin } from "@yukino.js/sentry/plugins";
import { ReactErrorBoundary } from "@yukino.js/sentry/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { createRoot } from "react-dom/client";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/query-client";
import App from "./app";
import "./index.css";

// Dev-only until the backend gains a report endpoint; the Vite mock plugin
// collects reports into logs/*.jsonl (see vite.config.ts).
if (import.meta.env.DEV) {
  init({ dsn: "/api/log", projectId: "yukino-chat" });
  enablePlugin(new PerformancePlugin(), new ScreenRecordPlugin());
}

createRoot(document.getElementById("root")!).render(
  <ReactErrorBoundary
    fallback={
      <div className="bg-background flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground text-center">Something went wrong</p>
      </div>
    }
  >
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <MotionConfig reducedMotion="user">
          <TooltipProvider delay={300}>
            <App />
            <Toaster position="top-right" richColors closeButton />
          </TooltipProvider>
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  </ReactErrorBoundary>,
);
