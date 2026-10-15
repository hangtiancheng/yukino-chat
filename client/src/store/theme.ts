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

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

export function initTheme() {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  useThemeStore.setState({ systemIsDark: media.matches });
  media.addEventListener("change", (event) => {
    useThemeStore.setState({ systemIsDark: event.matches });
  });
  useThemeStore.subscribe((state) => applyTheme(resolveTheme(state)));
  applyTheme(resolveTheme(useThemeStore.getState()));
}

export function useTheme() {
  const theme = useThemeStore((state) => state.theme);
  const resolvedTheme = useThemeStore(resolveTheme);
  const setTheme = useThemeStore((state) => state.setTheme);
  return { theme, resolvedTheme, setTheme };
}
