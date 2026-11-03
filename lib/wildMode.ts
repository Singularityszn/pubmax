// The wild switch controls the remaining round-two previews from
// docs/plans/DESIGN_UX_PLAN.md section 12. The normal Sign Foundry photo
// fallback is independent of this switch. PubSignSlot owns that distinction.
//
// It is a per-browser preference, not a flag on the server: `?wild=1` on any
// page turns it on and keeps it on in this browser, `?wild=0` turns it off.
// Once read, the param is taken off the address (adoptWildModeFromAddress),
// so a link copied or shared from that page cannot switch it on for someone
// else.
// Gated previews use dynamic imports that wait for this switch.
//
// This module imports only the storage leaf, so a bundle that asks for the
// switch pulls nothing else in behind it.

import { safeLocalStorage } from "./safeStorage";

export const WILD_MODE_STORAGE_KEY = "pubmax-wild";
const WILD_MODE_PARAM = "wild";

const listeners = new Set<() => void>();

export function readWildMode(): boolean {
  const store = safeLocalStorage();
  if (!store) return false;
  try {
    return store.getItem(WILD_MODE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeWildMode(on: boolean): void {
  const store = safeLocalStorage();
  if (store) {
    try {
      if (on) store.setItem(WILD_MODE_STORAGE_KEY, "1");
      else store.removeItem(WILD_MODE_STORAGE_KEY);
    } catch {
      // A browser that refuses storage keeps the switch for this page only.
    }
  }
  for (const listener of listeners) listener();
}

/**
 * Reads `?wild=1` or `?wild=0` from a query string and stores the answer.
 * Returns the stored state, or null when the query does not mention the switch.
 */
export function adoptWildModeParam(search: string): boolean | null {
  let value: string | null = null;
  try {
    value = new URLSearchParams(search).get(WILD_MODE_PARAM);
  } catch {
    return null;
  }
  if (value === "1" || value === "on") {
    writeWildMode(true);
    return true;
  }
  if (value === "0" || value === "off") {
    writeWildMode(false);
    return false;
  }
  return null;
}

/** The param's name in one `name=value` piece of a query, decoded as URLSearchParams decodes it. */
function paramName(piece: string): string {
  const equals = piece.indexOf("=");
  const raw = (equals === -1 ? piece : piece.slice(0, equals)).replace(/\+/g, " ");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * The query string with every `wild` param taken out and every other piece
 * left exactly as written, or null when the query does not mention the switch.
 * "?sel=a&wild=1" gives "?sel=a"; "?wild=1" gives "".
 */
export function searchWithoutWildModeParam(search: string): string | null {
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (!query) return null;
  const pieces = query.split("&");
  const kept = pieces.filter((piece) => paramName(piece) !== WILD_MODE_PARAM);
  if (kept.length === pieces.length) return null;
  return kept.length > 0 ? `?${kept.join("&")}` : "";
}

/**
 * Adopts `?wild=1` or `?wild=0` from this page's address, then takes the param
 * off the address in place: the same path, the other params and the hash, with
 * no navigation and no new history entry. The switch is this browser's own, so
 * a link copied from the page afterwards does not carry it. Returns what
 * adoptWildModeParam returns.
 */
export function adoptWildModeFromAddress(): boolean | null {
  if (typeof window === "undefined") return null;
  const { location, history } = window;
  const adopted = adoptWildModeParam(location.search);
  const search = searchWithoutWildModeParam(location.search);
  if (search !== null) {
    try {
      // The history state is passed through untouched, as AuthProvider does
      // for its own params, so the router keeps the entry it wrote.
      history.replaceState(history.state, "", `${location.pathname}${search}${location.hash}`);
    } catch {
      // A browser that refuses the rewrite keeps the param; the switch is stored either way.
    }
  }
  return adopted;
}

export function subscribeWildMode(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === WILD_MODE_STORAGE_KEY) onChange();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** True when the reader asked for reduced motion; false on the server. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
