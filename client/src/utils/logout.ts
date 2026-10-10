import { queryClient } from "@/lib/query-client";
import { user } from "@/service/api";
import useAuthStore from "@/store/auth";
import useWsStore from "@/store/ws";

export async function performLogout(): Promise<void> {
  const { uuid } = useAuthStore.getState().userInfo;
  if (uuid) {
    await user.wsLogout(uuid).catch(() => undefined);
  }
  useWsStore.getState().disconnect();
  useAuthStore.getState().clearAuth();
  queryClient.clear();
}
