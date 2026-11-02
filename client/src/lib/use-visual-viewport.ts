import { useEffect } from "react";

/** Keep the app and portalled dialogs inside the visible area above the keyboard. */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    let frame = 0;

    const update = () => {
      // Let the browser handle pinch zoom without relaying out the application.
      if (viewport && viewport.scale !== 1) return;
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      root.style.setProperty("--app-height", `${height}px`);
      root.style.setProperty("--app-offset-top", `${top}px`);
      root.style.setProperty(
        "--app-viewport-bottom",
        `${Math.max(0, window.innerHeight - height - top)}px`,
      );
    };
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("resize", scheduleUpdate);
    viewport?.addEventListener("resize", scheduleUpdate);
    viewport?.addEventListener("scroll", scheduleUpdate);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleUpdate);
      viewport?.removeEventListener("resize", scheduleUpdate);
      viewport?.removeEventListener("scroll", scheduleUpdate);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-offset-top");
      root.style.removeProperty("--app-viewport-bottom");
    };
  }, []);
}
