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
    match: ["/discover", "/feed", "/crawls", "/borough"],
  },
  { key: "you", href: "/u/you", label: "You", match: ["/u", "/pal"] },
] as const;

export const MOMENT_NAV_ACTION = {
  key: "moment",
  href: "/moment",
  label: "Moment",
} as const;

export type MomentReturnTarget = "/map" | "/tonight" | "/feed" | "/u/you";

const SAFE_MOMENT_RETURN_TARGETS = new Set<MomentReturnTarget>([
  "/map",
  "/tonight",
  "/feed",
  "/u/you",
]);

export function safeMomentReturnTo(value: string | null | undefined): MomentReturnTarget {
  if (!value) return "/map";
  const path = value.split("?")[0]?.split("#")[0] as MomentReturnTarget | undefined;
  return path && SAFE_MOMENT_RETURN_TARGETS.has(path) ? path : "/map";
}

export function momentHref(returnTo: string | null | undefined): string {
  return `${MOMENT_NAV_ACTION.href}?returnTo=${encodeURIComponent(safeMomentReturnTo(returnTo))}`;
}
