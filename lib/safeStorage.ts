// The ONE way this app reaches `localStorage` / `sessionStorage`.
//
// Both are PROPERTY GETTERS on `window`, and a browser with site data blocked
// - "Block all cookies", a sandboxed frame without allow-same-origin - RAISES
// on the read itself. So `!!window.localStorage` is a throwing expression, and
// a helper shaped that way in a render body (a `useSyncExternalStore`
// getSnapshot is one) takes the whole tree down rather than costing a saved
// preference. Every reader goes through here: a blocked browser gets null and
// the surface degrades, which is what a stored convenience is worth.
//
// This module imports NOTHING, so a bundle that needs one preference never
// pulls anything else in behind it.

export function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function safeSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
