import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface PreferencesState {
  rememberedPhone: string;
  setRememberedPhone: (phone: string) => void;
}

const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      rememberedPhone: "",
      setRememberedPhone: (rememberedPhone) => set({ rememberedPhone }),
    }),
    {
      name: "yukino-preferences",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export default usePreferencesStore;
