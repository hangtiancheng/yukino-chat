import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { AuthResult, UserInfo } from "@/service/schemas";

export const emptyUser: UserInfo = {
  uuid: "",
  nickname: "",
  telephone: "",
  email: "",
  avatar: "",
  gender: 0,
  birthday: "",
  signature: "",
  status: 0,
  is_admin: 0,
  created_at: "",
};

export interface AuthState {
  token: string;
  userInfo: UserInfo;
  setAuth: (result: AuthResult) => void;
  setUserInfo: (info: UserInfo) => void;
  clearAuth: () => void;
}

const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: "",
      userInfo: emptyUser,
      setAuth: (result) =>
        set({ token: result.token, userInfo: result.user_info }),
      setUserInfo: (userInfo) => set({ userInfo }),
      clearAuth: () => set({ token: "", userInfo: emptyUser }),
    }),
    {
      name: "yukino-auth",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ token: state.token, userInfo: state.userInfo }),
    },
  ),
);

export const selectIsLoggedIn = (state: AuthState) =>
  Boolean(state.token && state.userInfo.uuid);

export const isAuthenticated = () => selectIsLoggedIn(useAuthStore.getState());

export const currentUserId = () => useAuthStore.getState().userInfo.uuid;

export default useAuthStore;
