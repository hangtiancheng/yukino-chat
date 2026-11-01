import { create } from "zustand";

interface UiState {
  /** Command palette (⌘K) visibility. Mobile has no ⌘ key, so the bottom
   *  navigation exposes a button that flips this instead. */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
}

const useUiStore = create<UiState>()((set) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
}));

export default useUiStore;
