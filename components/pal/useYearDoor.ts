import { useSyncExternalStore } from "react";

/** The section /year-in-pints lands on (next.config.mjs sends it to /pal#year-in-pints). */
export const YEAR_DOOR_ID = "year-in-pints";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * True when the visitor came for their year. The hash never reaches the
 * server, so the prerendered /pal stays one document for every stranger and
 * this reads false until the browser has it.
 */
export function useYearDoor(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash === `#${YEAR_DOOR_ID}`,
    () => false,
  );
}
