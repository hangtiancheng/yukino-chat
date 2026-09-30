import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="bg-primary/5 pointer-events-none absolute -top-24 right-1/4 h-80 w-80 rounded-full blur-3xl"
      />
      <div
        aria-hidden
        className="bg-primary/10 pointer-events-none absolute -bottom-32 left-1/4 h-96 w-96 rounded-full blur-3xl"
      />

      <motion.div
        className="text-center"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <h1 className="text-primary/20 text-8xl font-bold">404</h1>
        <p className="text-muted-foreground mt-4">Page not found</p>
        <Button className="mt-8" onClick={() => navigate("/login")}>
          Back to Home
        </Button>
      </motion.div>
    </div>
  );
}
