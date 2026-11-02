import { motion } from "motion/react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-viewport bg-background safe-pt safe-pb overflow-y-auto overscroll-contain">
      <div className="fixed top-[max(0.5rem,env(safe-area-inset-top))] right-[max(0.5rem,env(safe-area-inset-right))] z-10">
        <ThemeToggle className="bg-card/80 size-11 rounded-full backdrop-blur-sm" />
      </div>
      {/* Decorative blobs are fixed so they never extend the scroll area. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <motion.div
          className="bg-primary/10 absolute -top-32 -left-32 size-96 rounded-full blur-3xl"
          animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0.9, 0.6] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="bg-primary/5 absolute -right-24 -bottom-40 size-[28rem] rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{
            duration: 9,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 1.5,
          }}
        />
        <div className="bg-primary/[0.07] absolute top-1/4 right-1/3 size-64 rounded-full blur-3xl" />
      </div>

      {/* min-h-full + items-center keeps the card centered when it fits and
          top-aligned (never clipped) when the keyboard shrinks the viewport. */}
      <div className="relative flex min-h-full items-center justify-center p-4 py-6">
        <motion.div
          className="w-full max-w-md"
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}
