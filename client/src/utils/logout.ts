import { queryClient } from "@/lib/query-client";
import { user } from "@/service/api";
import useAuthStore from "@/store/auth";
import useWsStore from "@/store/ws";

/**
 * Tear down auth + websocket session. Callers should navigate
 * to "/login" after this resolves.
 */
export async function performLogout(): Promise<void> {
  const { uuid } = useAuthStore.getState().userInfo;
  if (uuid) {
    // Clearing local state must happen even if the server never hears about it.
    await user.wsLogout(uuid).catch(() => undefined);
  }
  useWsStore.getState().disconnect();
  useAuthStore.getState().clearAuth();
  queryClient.clear();
}
