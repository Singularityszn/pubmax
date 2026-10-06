import type { Route } from "next";

export type PrimaryNavKey = "now" | "map" | "places" | "out" | "plan" | "you";

export type PrimaryNavItem = {
  key: PrimaryNavKey;
  href: Route;
  label: string;
  match: string[];
};

/**
 * The six durable destinations in the PUBMAXX shell, and the ONE vocabulary for
 * every bar that names them: the phone dock, the desktop SiteNav and the landing
 * bar all render this list, so their labels cannot drift apart again.
 *
 * The row follows the loop: find (Tonight, Map, Places, Out), plan (Plan), and
 * You. Social and Moment are not front doors. Social answers a stranger with
 * "Sign in to use Social.", so it lives in the desktop More menu and on the You
 * hub; Moment is a compose action, never a location, and is modelled separately
 * below.
 *
 * The `now` key reads "Tonight" and opens /tonight at every hour, so the word
 * and the page always agree. It still lights on /today as well, and the page's
 * own Day | Tonight segment is the daytime door. Map stays canonical /map.
 *
 * Places sits beside Map because the two answer the same question in opposite
 * order: Map opens ONE city, and Places is where a reader chooses WHICH. It is a
 * destination rather than a control inside Map, because the city it sets is read
 * by Out and Near as well, so it was never the map's own setting to own.
 */
export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { key: "now", href: "/tonight", label: "Tonight", match: ["/today", "/tonight"] },
  { key: "map", href: "/map", label: "Map", match: ["/map"] },
  // The picker's retired address, /choose-city, is NOT in the match set: it has
  // no page any more and 308s at the edge (proxy.ts), so no client is ever on
  // that pathname.
  { key: "places", href: "/places", label: "Places", match: ["/places"] },
  { key: "out", href: "/out", label: "Out", match: ["/out"] },
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
