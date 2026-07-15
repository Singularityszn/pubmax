export type PrimaryNavKey = "map" | "tonight" | "moment" | "stories" | "you";

export type PrimaryNavItem = {
  key: PrimaryNavKey;
  href: string;
  label: string;
  match: string[];
};

/**
 * The five durable jobs in the PUBMAXX shell. Both navigation components read
 * this registry so mobile and desktop cannot drift into different products.
 * City-aware map URLs are applied at render time.
 */
export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { key: "map", href: "/map", label: "Map", match: ["/map"] },
  { key: "tonight", href: "/tonight", label: "Tonight", match: ["/tonight"] },
  { key: "moment", href: "/map?log=1", label: "Moment", match: ["/__moment__"] },
  {
    key: "stories",
    href: "/discover",
    label: "Stories",
    match: ["/discover", "/feed", "/crawls", "/borough"],
  },
  { key: "you", href: "/u/you", label: "You", match: ["/u", "/pal"] },
] as const;
