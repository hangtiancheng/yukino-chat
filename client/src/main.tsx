import { enablePlugin, init } from "@yukino.js/sentry";
import {
  PerformancePlugin,
  ScreenRecordPlugin,
} from "@yukino.js/sentry/plugins";
import { ReactErrorBoundary } from "@yukino.js/sentry/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { createRoot } from "react-dom/client";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/query-client";
import { initTheme } from "@/store/theme";
import App from "./app";
import "./index.css";

if (import.meta.env.DEV) {
  init({ dsn: "/api/log", projectId: "yukino-chat" });
  enablePlugin(new PerformancePlugin(), new ScreenRecordPlugin());
}

initTheme();

createRoot(document.getElementById("root")!).render(
  <ReactErrorBoundary
    fallback={
      <div className="bg-background flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground text-center">
          Something went wrong
        </p>
      </div>
    }
  >
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delay={300}>
          <App />
          <Toaster position="top-right" richColors closeButton />
        </TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  </ReactErrorBoundary>,
);
