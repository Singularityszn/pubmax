// Types for scripts/harvest/uk-prices/menu-urls.mjs.
//
// `allowJs` is false, so a plain-ESM module that a TypeScript file imports needs
// a sidecar. This is the same pattern lib/brandMark.mjs and
// scripts/whatson/greeneKingSportParser.mjs wear, and for the same reason: the
// crawl lanes are plain-node CLIs and cannot import a TypeScript module, while
// the fence over them is a TypeScript test.

/** One overlay menu page, ready to be read by a crawl lane. */
export type OverlayMenuUrlTarget = {
  /** The UK base layer's id for the pub, or null when the ref is not the shards' shape. */
  venueId: string | null;
  /** The canonical OSM id the overlay keys on, e.g. `node/123`. */
  osmId: string | null;
  /** The salted ref the shards carry, e.g. `n123`. */
  osmRef: string | null;
  host: string;
  menuUrl: string;
};

/** Every reason an overlay row produced no crawlable menu URL, plus the one that did. */
export type OverlayMenuUrlOutcome =
  | "usable"
  | "no-menu-url"
  | "policy-refused-host"
  | "unparseable-url";

/** The committed input file, cut from `harvest_venue_overlays`. */
export type OverlayMenuUrlInput = {
  version: number;
  readAt: string;
  source: string;
  /** Which door the answer was taken through. */
  readVia: "service-role-rest" | "supabase-mcp-session";
  counts: Record<string, number>;
  refusedHosts: Record<string, number>;
  urls: OverlayMenuUrlTarget[];
};

export declare const OVERLAY_MENU_URL_INPUT_PATH: string;
export declare const ROW_OUTCOMES: readonly OverlayMenuUrlOutcome[];

export declare function selectMenuUrls(rows: readonly unknown[]): {
  targets: OverlayMenuUrlTarget[];
  outcomes: Record<OverlayMenuUrlOutcome, number>;
  refusedHosts: Record<string, number>;
};

export declare function ukBaseVenueId(osmRef: unknown): string | null;

/** The committed input, or null when the file is absent or unreadable. */
export declare function readOverlayMenuUrlInput(file?: string): OverlayMenuUrlInput | null;

/** The targets a lane may read, re-asking the permission gate on the way out. */
export declare function crawlableOverlayMenuUrls(
  input: Partial<OverlayMenuUrlInput> | null | undefined,
): OverlayMenuUrlTarget[];
