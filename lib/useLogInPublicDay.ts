import { useSyncExternalStore } from "react";

import { LOG_IN_PUBLIC_DAY, logInPublicDayActive } from "@/lib/logInPublicDay";

const subscribe = () => () => {};
const readDay = () => (logInPublicDayActive(new Date()) ? LOG_IN_PUBLIC_DAY : null);
const serverDay = () => null;

/**
 * The log in public day when the reader's London clock is on it, else null.
 * Prerendered pages render null, and the browser answers after hydration.
 */
export function useLogInPublicDay(): string | null {
  return useSyncExternalStore(subscribe, readDay, serverDay);
}
