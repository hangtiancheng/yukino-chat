import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    // Either an absolute origin (http://localhost:8000 — direct backend, used
    // in dev) or a same-origin path prefix (/api — Nginx reverse-proxies it
    // to the backend, used in production). Empty is treated as undefined.
    VITE_API_URL: z.string().default("http://localhost:8000"),
    // Optional absolute ws(s):// override; derived from VITE_API_URL otherwise.
    VITE_WS_URL: z.string().optional(),
  },
  runtimeEnv: import.meta.env,
  emptyStringAsUndefined: true,
});

const withoutTrailingSlash = (url: string) => url.replace(/\/+$/, "");

export const apiUrl = withoutTrailingSlash(env.VITE_API_URL);

/**
 * Browsers require an absolute ws(s):// URL, so a relative API prefix is
 * resolved against the current page origin (the Nginx entry point).
 */
function deriveWsBase(api: string): string {
  if (/^wss?:\/\//iu.test(api)) return api;
  if (/^https?:\/\//iu.test(api)) return api.replace(/^http/iu, "ws");
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const path = api.startsWith("/") ? api : `/${api}`;
  return `${proto}//${window.location.host}${path}`;
}

export const wsUrl = withoutTrailingSlash(env.VITE_WS_URL ?? deriveWsBase(apiUrl));

export function staticUrl(path: string): string {
  if (!path) return "";
  if (/^(https?:|wss?:|data:|blob:)/.test(path)) return path;
  return apiUrl + (path.startsWith("/") ? path : `/${path}`);
}
