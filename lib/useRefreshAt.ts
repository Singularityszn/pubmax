"use client";

// Reads a page again at one known moment, and whenever the page comes back into view.
// No polling: one timer to the boundary, plus focus and visibility. Each new read
// re-arms the timer, so a read that repeats a passed boundary checks once more.

import { useEffect } from "react";

const MAX_TIMER_MS = 2_147_483_647;

export function useRefreshAt(read: { refreshAt: number | null } | null | undefined, enabled: boolean, refresh: () => void) {
  const refreshAt = read?.refreshAt;
  useEffect(() => {
    if (!enabled) return;
    const resume = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", resume);
    const timer = typeof refreshAt === "number"
      ? setTimeout(refresh, Math.min(MAX_TIMER_MS, Math.max(1_000, refreshAt - Date.now())))
      : undefined;
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", resume);
      clearTimeout(timer);
    };
  }, [enabled, read, refresh, refreshAt]);
}
