import { useMediaQuery } from "@/lib/use-media-query";

/**
 * Mirrors Tailwind's `md` breakpoint (48rem): anything below it is treated as
 * the mobile layout, so `useIsMobile()` and `md:` classes never disagree.
 */
export const MOBILE_QUERY = "(max-width: 47.9375rem)";

/** True on phones / small tablets — drives single-pane master-detail layouts. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}

/** True when the primary input is a finger rather than a mouse. */
export function useIsTouch(): boolean {
  return useMediaQuery("(pointer: coarse)");
}
