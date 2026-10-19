// Types for scripts/harvest/uk-prices/exaSites.mjs. See menu-urls.d.mts for why
// a plain-ESM crawl module wears a sidecar.

/** What a page must state for an Exa-found site to be this pub's. */
export type ExaSiteBinding = {
  /** OSM's postcode in canonical spaced form, e.g. `WC1N 3LZ`. */
  postcode: string | null;
  /** OSM's house number and street, e.g. `94 Lamb's Conduit Street`. */
  streetAddress: string | null;
};

export type ExaSiteOutcome =
  | "candidate"
  | "no-site"
  | "unparseable-url"
  | "policy-refused-host"
  | "not-a-pubs-own-host"
  | "no-address";

export type ExaSiteCandidate = {
  venueId: string;
  osmId: string;
  osmRef: string;
  name: string;
  lat: number;
  lng: number;
  host: string;
  siteUrl: string;
  menuUrl: string | null;
  binding: ExaSiteBinding;
};

export type CrawlHostEntry = {
  host: string;
  origin: string | null;
  exaSite?: boolean;
  seedPages?: string[];
  pubs: Array<Record<string, unknown>>;
};

export declare const EXA_SITE_OUTCOMES: readonly ExaSiteOutcome[];
export declare const NOT_A_PUBS_OWN_SITE: RegExp;

export declare function hostOfUrl(url: string): string | null;
export declare function canonicalPostcode(value: unknown): string | null;
export declare function bindingFromAddressTags(tags: unknown): ExaSiteBinding | null;
export declare function pageBindsPub(body: string, binding: ExaSiteBinding | null): boolean;
export declare function contactLinkCandidates(html: string, origin: string, limit?: number): string[];

export declare function selectExaSiteCandidates(
  overlayRows: ReadonlyArray<{ osmId: string; osmRef: string; website: string | null; menuUrl: string | null }>,
  seedByOsmId: ReadonlyMap<string, { name: string; lat: number; lng: number; addressTags?: Record<string, string> }>,
  options: { isHarvestableOperatorUrl: (url: string) => boolean },
): {
  candidates: ExaSiteCandidate[];
  outcomes: Record<ExaSiteOutcome, number>;
  refusedHosts: Record<string, number>;
};

export declare function addExaSiteHosts(
  hostEntries: CrawlHostEntry[],
  candidates: readonly ExaSiteCandidate[],
  options?: { publishedHosts?: ReadonlySet<string>; sourceTableHosts?: readonly string[] },
): {
  considered: number;
  seededOnKnownHost: number;
  hostsAdded: number;
  sharedHost: number;
  estateHost: number;
  alreadyPublished: number;
};
