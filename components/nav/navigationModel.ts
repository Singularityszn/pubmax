import type { Route } from "next";

export type PrimaryNavKey = "map" | "now" | "plan" | "spoons" | "social" | "you";

export type PrimaryNavItem = {
  key: PrimaryNavKey;
  href: Route;
  label: string;
  match: string[];
};

/**
 * The routes Social owns: its canonical shell plus the retired aliases that
 * still render or 308 there, so a reader on /feed or /stories sees the
 * Social tab lit.
 *
 * /crawls is NOT one of them. It renders a page of its own, the walkable
 * route packs, and every door into it is a planning door: Tonight's "More
 * ways to plan tonight", the historic page's "Start a crawl", a landmark's
 * "Browse route packs". So it lights Plan, and a crawl story at
 * /crawls/<slug> lights Plan the way a shared plan at /plan/<id> does.
 */
export const SOCIAL_NAV_MATCH: readonly string[] = [
  "/social",
  "/discover",
  "/drinks",
  "/feed",
  "/stories",
];

/** The routes Plan owns: the composer, a shared plan and the crawl routes. */
const PLAN_NAV_MATCH: readonly string[] = ["/plan", "/crawls"];

/**
 * The six durable destinations in the PUBMAXX shell, and the ONE vocabulary
 * for every bar that names them: the phone dock, the desktop SiteNav and the
 * landing bar all render this list, so their labels cannot drift apart again.
 *
 * Spoons opens the published value ranking directly on phones and desktops.
 * The captain requested this extra tab on 26 October 2026. Pub Pal keeps its
 * separate door between Tonight and Plan. Moment remains a compose action.
 *
 * Two former tabs left primary navigation. Out IS Tonight now: /out 308s to
 * /tonight at the edge (proxy.ts), and Tonight carries the Tomorrow and Weekend
 * listings. Places is no longer a destination: the city picker still lives at
 * /places, reached from the map's own city chip and the footer's "Pick your
 * city", because choosing a city is a setting a reader makes once, not a place
 * they go back to every night. Neither /out nor /places lights a tab.
 *
 * The `now` key keeps the Tonight label. Main links use useNowHref.
 * The hook owns the automatic default and the stable server fallback.
 * Both pages belong to this tab. Explicit page links keep their destination.
 */
export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { key: "map", href: "/map", label: "Map", match: ["/map"] },
  { key: "now", href: "/tonight", label: "Tonight", match: ["/today", "/tonight"] },
  // Plan owns the composer, a shared plan at /plan/[id] and the crawl routes
  // (PLAN_NAV_MATCH).
  { key: "plan", href: "/plan", label: "Plan", match: [...PLAN_NAV_MATCH] },
  { key: "spoons", href: "/spoons-value", label: "Spoons", match: ["/spoons-value"] },
  // Social owns its shell and its retired aliases (SOCIAL_NAV_MATCH). The label
  // here is the launched name; a bar names it through primaryNavLabel.
  { key: "social", href: "/social", label: "Social", match: [...SOCIAL_NAV_MATCH] },
  // You owns the profile surfaces under /u only. /pal (Pub Pal, the AI
  // concierge) is its OWN destination with no primary tab — it used to sit in
  // this match set and wrongly lit "You" on both the mobile tab bar and the
  // desktop nav (audit F10). Dropped so /pal maps to no active tab.
  { key: "you", href: "/u/you" as Route, label: "You", match: ["/u"] },
] as const;

/**
 * The name a bar prints for a primary destination. Social is named for its
 * launch state ("Social preview" while the friends launch is rolled back), so
 * no bar names it more plainly than the page it opens.
 */
export function primaryNavLabel(item: { key: string; label: string }, socialLabel: string): string {
  return item.key === "social" ? socialLabel : item.label;
}

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
