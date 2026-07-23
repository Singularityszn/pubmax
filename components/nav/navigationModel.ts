export type PrimaryNavKey = "map" | "tonight" | "stories" | "you";

export type PrimaryNavItem = {
  key: PrimaryNavKey;
  href: string;
  label: string;
  match: string[];
};

/**
 * The four durable destinations in the PUBMAXX shell. Moment is deliberately
 * modelled separately below because it is a compose action, never a location.
 * City-aware map URLs are applied at render time.
 */
export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { key: "map", href: "/map", label: "Map", match: ["/map"] },
  { key: "tonight", href: "/tonight", label: "Tonight", match: ["/tonight"] },
  {
    key: "stories",
    href: "/feed",
    label: "Stories",
    // Canonical surface is /feed. /stories is a retired alias (308 → /feed);
    // keep it in match so soft clients still light Stories if they land there
    // before the redirect settles. Borough pages are data/discovery, not
    // Stories — do not include /borough here (desktop SiteNav maps borough
    // via its own legacy-active handler and leaves it unlit).
    match: ["/discover", "/feed", "/stories", "/crawls"],
  },
  // You owns the profile surfaces under /u only. /pal (Pub Pal, the AI
  // concierge) is its OWN destination with no primary tab — it used to sit in
  // this match set and wrongly lit "You" on both the mobile tab bar and the
  // desktop nav (audit F10). Dropped so /pal maps to no active tab.
  { key: "you", href: "/u/you", label: "You", match: ["/u"] },
] as const;

export const MOMENT_NAV_ACTION = {
  key: "moment",
  href: "/moment",
  label: "Moment",
} as const;

/**
 * First-run tour spotlight targets, mapped to the live mobile tab keys. The
 * tour anchors its bottom-bar ring to the REAL tab column (see MobileTabBar
 * `buildTabs` / `tourSpotlightColumn`), so this is the single source tying tour
 * copy targets to nav destinations: "drop" is the Moment centre action, and
 * "discover" is the Stories tab. A new or reordered tab that shifts these keys'
 * columns is caught by the tour-geometry regression test.
 */
export type TourSpotlightTarget = "map" | "drop" | "discover";

export const TOUR_TARGET_TAB_KEY: Record<TourSpotlightTarget, string> = {
  map: "map",
  drop: MOMENT_NAV_ACTION.key,
  discover: "stories",
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
