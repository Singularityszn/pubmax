import { useSyncExternalStore } from "react";

import { LOG_IN_PUBLIC_DAY, logInPublicDayActive } from "@/lib/logInPublicDay";
import { LONDON_DAY_MS, londonMsSinceMidnight } from "@/lib/londonHour";
import { londonDayKey } from "@/lib/pintContributions";

function subscribe(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const refresh = () => {
    clearTimeout(timer);
    onChange();
    const now = new Date();
    const nextUtcMidnight = new Date(Date.parse(`${londonDayKey(now)}T00:00:00Z`) + LONDON_DAY_MS);
    const nextLondonMidnight = nextUtcMidnight.getTime() - londonMsSinceMidnight(nextUtcMidnight);
    timer = setTimeout(refresh, nextLondonMidnight - now.getTime());
  };
  refresh();
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("pageshow", refresh);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", refresh);
    window.removeEventListener("pageshow", refresh);
  };
}
const readDay = () => (logInPublicDayActive(new Date()) ? LOG_IN_PUBLIC_DAY : null);
const serverDay = () => null;

/**
 * The log in public day when the reader's London clock is on it, else null.
 * Prerendered pages render null, and the browser answers after hydration.
 */
export function useLogInPublicDay(): string | null {
  return useSyncExternalStore(subscribe, readDay, serverDay);
}
