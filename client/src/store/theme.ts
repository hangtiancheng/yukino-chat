import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  systemIsDark: boolean;
  setTheme: (theme: Theme) => void;
}

const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "system",
      systemIsDark: false,
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "yukino-theme",
      partialize: (state) => ({ theme: state.theme }),
    },
  ),
);

const resolveTheme = (state: ThemeState): ResolvedTheme =>
  state.theme === "system"
    ? state.systemIsDark
      ? "dark"
      : "light"
    : state.theme;

let transitionTimer: ReturnType<typeof setTimeout> | undefined;
let activeTransition: ViewTransition | undefined;
let themeChangeId = 0;

function applyTheme(resolved: ResolvedTheme, animate = false) {
  const changeId = ++themeChangeId;
  const root = document.documentElement;
  const shouldAnimate =
    animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  clearTimeout(transitionTimer);
  activeTransition?.skipTransition();
  root.classList.remove("theme-switching");

  const update = () => {
    if (changeId !== themeChangeId) return;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolved === "dark" ? "#151b17" : "#f4f7f2");
  };

  if (shouldAnimate && typeof document.startViewTransition === "function") {
    // One composited crossfade avoids animating every element in long chats.
    const transition = document.startViewTransition(update);
    activeTransition = transition;
    void transition.ready.catch(() => {});
    void transition.finished
      .catch(() => {})
      .then(() => {
        if (activeTransition === transition) activeTransition = undefined;
      });
  } else if (shouldAnimate) {
    root.classList.add("theme-switching");
    update();
    transitionTimer = setTimeout(
      () => root.classList.remove("theme-switching"),
      320,
    );
  } else {
    update();
  }
}

export function initTheme() {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  useThemeStore.setState({ systemIsDark: media.matches });
  media.addEventListener("change", (event) => {
    useThemeStore.setState({ systemIsDark: event.matches });
  });
  applyTheme(resolveTheme(useThemeStore.getState()));
  useThemeStore.subscribe((state, previous) => {
    if (resolveTheme(state) !== resolveTheme(previous)) {
      applyTheme(resolveTheme(state), true);
    }
  });
}

export function useTheme() {
  const theme = useThemeStore((state) => state.theme);
  const resolvedTheme = useThemeStore(resolveTheme);
  const setTheme = useThemeStore((state) => state.setTheme);
  return { theme, resolvedTheme, setTheme };
}
