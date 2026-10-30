"use client";

// One live clock for Last orders. It ticks while the page is open, and it
// reads the clock again the moment a tab comes back (a phone unlocked, a tab
// brought forward, a page restored from the back-forward cache), because a
// background tab's timers are slowed or frozen and a countdown must never wake
// up showing the minute it fell asleep on.
//
// `null` until the first read after mount, so a prerendered first paint never
// carries the build's clock.

import { useEffect, useState } from "react";

export function useLiveClock(tickMs: number, enabled = true): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const read = () => setNow(new Date());
    const onVisible = () => {
      if (document.visibilityState === "visible") read();
    };
    const first = window.setTimeout(read, 0);
    const timer = window.setInterval(read, tickMs);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", read);
    window.addEventListener("focus", read);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", read);
      window.removeEventListener("focus", read);
    };
  }, [tickMs, enabled]);
  return now;
}
