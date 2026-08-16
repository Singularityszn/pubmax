import { londonHour } from "@/lib/ambientPresence";

export type PrimaryNavKey = "now" | "map" | "out" | "social" | "you";

export type PrimaryNavItem = {
  key: PrimaryNavKey;
  href: string;
  label: string;
  match: string[];
};

/**
 * The five durable destinations in the PUBMAXX shell. Moment is deliberately
 * modelled separately below because it is a compose action, never a location.
 * City-aware map URLs and the time-aware Now href are applied at render time.
 */
export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { key: "now", href: "/today", label: "Now", match: ["/today", "/tonight"] },
  { key: "map", href: "/map", label: "Map", match: ["/map"] },
  { key: "out", href: "/out", label: "Out", match: ["/out"] },
  {
    key: "social",
    href: "/social",
    label: "Social",
    // Keep retired aliases in the match set so soft clients light the canonical
    // destination while a permanent redirect settles.
    match: ["/social", "/discover", "/drinks", "/feed", "/stories", "/crawls"],
  },
  // You owns the profile surfaces under /u only. /pal (Pub Pal, the AI
  // concierge) is its OWN destination with no primary tab — it used to sit in
  // this match set and wrongly lit "You" on both the mobile tab bar and the
  // desktop nav (audit F10). Dropped so /pal maps to no active tab.
  { key: "you", href: "/u/you", label: "You", match: ["/u"] },
] as const;

/** Now keeps /today and /tonight live. The tab href flips at 17:00 London. */
export function nowTabHref(at: Date = new Date()): "/today" | "/tonight" {
  return londonHour(at) < 17 ? "/today" : "/tonight";
}

const NOW_TAB_TICK_MS = 30_000;

export function subscribeNowTabHref(onStoreChange: () => void): () => void {
  const id = window.setInterval(onStoreChange, NOW_TAB_TICK_MS);
  return () => window.clearInterval(id);
}

export const MOMENT_NAV_ACTION = {
  key: "moment",
  href: "/moment",
  label: "Moment",
} as const;

/**
 * First-run tour spotlight targets, mapped to the live mobile tab keys. The
 * tour anchors its bottom-bar ring to the REAL tab column (see MobileTabBar
 * `buildTabs` / `tourSpotlightColumn`), so this is the single source tying tour
 * copy targets to nav destinations: "drop" is the floating create action,
 * not a tab column, and "social" is the Social tab. A new or reordered tab
 * that shifts these keys' columns is caught by the tour-geometry regression
 * test.
 */
export type TourSpotlightTarget = "map" | "drop" | "social";

export const TOUR_TARGET_TAB_KEY: Record<TourSpotlightTarget, string> = {
  map: "map",
  drop: "create-fab",
  social: "social",
} as const;

export type MomentReturnTarget = string;

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
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/map";
  }
}

export function momentHref(returnTo: string | null | undefined): string {
  return `${MOMENT_NAV_ACTION.href}?returnTo=${encodeURIComponent(safeMomentReturnTo(returnTo))}`;
}
