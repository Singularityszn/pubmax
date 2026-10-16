import type { Route } from "next";

export type PrimaryNavKey = "map" | "now" | "plan" | "you";

export type PrimaryNavItem = {
  key: PrimaryNavKey;
  href: Route;
  label: string;
  match: string[];
};

/**
 * The FOUR durable destinations in the PUBMAXX shell, and the ONE vocabulary
 * for every bar that names them: the phone dock, the desktop SiteNav and the
 * landing bar all render this list, so their labels cannot drift apart again.
 *
 * Product owner, Oct 2026 UX audit: six tabs were two doors too many, so the
 * row is a four-door loop, in this order. Map finds the pint (the answer the
 * product exists to give), Tonight says what is worth going out for, Plan turns
 * that into a route, and You keeps what the night left behind. Social and
 * Moment are not front doors. Social answers a stranger with "Sign in to use
 * Social.", so it lives in the desktop More menu and on the You hub; Moment is
 * a compose action, never a location, and is modelled separately below.
 *
 * Two former tabs folded into the four. Out IS Tonight now: /out 308s to
 * /tonight at the edge (proxy.ts), and Tonight carries the Tomorrow and Weekend
 * listings. Places is no longer a destination: the city picker still lives at
 * /places, reached from the map's own city chip and the footer's "Pick your
 * city", because choosing a city is a setting a reader makes once, not a place
 * they go back to every night. Neither /out nor /places lights a tab.
 *
 * The `now` key reads "Tonight" and opens /tonight at every hour, so the word
 * and the page always agree. The daytime door is the page's own Day | Tonight
 * segment. Map stays canonical /map.
 */
export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { key: "map", href: "/map", label: "Map", match: ["/map"] },
  { key: "now", href: "/tonight", label: "Tonight", match: ["/tonight"] },
  // Plan owns the composer and a shared plan at /plan/[id].
  { key: "plan", href: "/plan", label: "Plan", match: ["/plan"] },
  // You owns the profile surfaces under /u only. /pal (Pub Pal, the AI
  // concierge) is its OWN destination with no primary tab — it used to sit in
  // this match set and wrongly lit "You" on both the mobile tab bar and the
  // desktop nav (audit F10). Dropped so /pal maps to no active tab.
  { key: "you", href: "/u/you" as Route, label: "You", match: ["/u"] },
] as const;

/**
 * The routes Social owns: its canonical shell plus the retired aliases that
 * still render or 308 there. Social is not a primary destination, so this set
 * lights the desktop More entry rather than a tab.
 */
export const SOCIAL_NAV_MATCH: readonly string[] = [
  "/social",
  "/discover",
  "/drinks",
  "/feed",
  "/stories",
  "/crawls",
];

export const MOMENT_NAV_ACTION = {
  key: "moment",
  href: "/moment",
  label: "Moment",
} as const;

export type MomentReturnTarget = Route;

const BLOCKED_MOMENT_RETURN_PREFIXES = ["/api", "/admin", "/auth", "/moment"];

/**
 * Path-prefix active matching for primary nav destinations. "/" only matches
 * the home route exactly (every path starts with "/").
 */
export function navPathMatches(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) =>
    prefix === "/"
      ? pathname === "/"
      : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Which durable primary destination owns `pathname`, if any. */
export function primaryNavKeyForPath(pathname: string): PrimaryNavKey | undefined {
  return PRIMARY_NAV_ITEMS.find((item) => navPathMatches(pathname, item.match))?.key;
}

export function safeMomentReturnTo(value: string | null | undefined): MomentReturnTarget {
  if (!value) return "/map";
  if (!value.startsWith("/") || value.startsWith("//")) return "/map";
  try {
    const url = new URL(value, "https://pubmaxxing.com");
    if (url.origin !== "https://pubmaxxing.com") return "/map";
    if (BLOCKED_MOMENT_RETURN_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) return "/map";
    // Same-origin path outside the blocked prefixes, checked above.
    return `${url.pathname}${url.search}${url.hash}` as Route;
  } catch {
    return "/map";
  }
}

export function momentHref(returnTo: string | null | undefined): Route {
  return `${MOMENT_NAV_ACTION.href}?returnTo=${encodeURIComponent(safeMomentReturnTo(returnTo))}`;
}
