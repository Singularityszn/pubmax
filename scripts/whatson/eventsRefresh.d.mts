// Hand-maintained declarations for eventsRefresh.mjs so the vitest suite
// type-checks under the repo's allowJs:false tsconfig. Keep in sync with
// the runtime module.
//
// The pure half lives in lib/whatson/eventNormalise.mjs (the request-time
// /api/out seams import it directly); this script re-exports it so existing
// callers keep one import site.

export type {
  EventDropCounts,
  EventSource,
  MapEventOpts,
  NormalisedEvents,
  WhatsOnEventKind,
  WhatsOnEventRow,
} from "../../lib/whatson/eventNormalise.d.mts";

export {
  EMPTY_EVENT_DROPS,
  EVENT_REFRESH_CITIES,
  SKIDDLE_BRAND_ASSET_PRESENT,
  SKIDDLE_EVENTCODE_KIND,
  SKIDDLE_SOURCE,
  TICKETMASTER_SEGMENT_KIND,
  TICKETMASTER_SOURCE,
  cityGeo,
  dedupeEventRowsBySourceId,
  emptyEventDrops,
  mapSkiddleEvent,
  mapTicketmasterEvent,
  normaliseSkiddleEvents,
  normaliseTicketmasterEvents,
  skiddleLaneFenced,
  summariseEventDrops,
  toIsoInstant,
} from "../../lib/whatson/eventNormalise.d.mts";

export declare function providerLaneStatus(env?: Record<string, string | undefined>): {
  ticketmaster: "configured" | "not-configured";
  skiddle: "configured" | "not-configured";
  contextdev: "configured" | "not-configured";
};
export declare function eventsOutputPath(city?: string): string;
export declare function readExistingRowsForLabels(
  filePath: string,
  labels: readonly string[],
): import("../../lib/whatson/eventNormalise.d.mts").WhatsOnEventRow[];
export declare function readExistingCommonRows(
  filePath: string,
): import("../../lib/whatson/eventNormalise.d.mts").WhatsOnEventRow[];
export declare function parseEventsCityArg(argv?: string[]): string | null;

/** Opt in to the Common crawl, so exactly one owner runs it per run. */
export declare const WITH_COMMON_FLAG: string;

export type EventsLaneReport = {
  status: "wrote" | "refused" | "failed" | "not-configured" | "skipped" | "ran";
  wrote?: boolean;
  rows?: number;
  reason?: string;
  /** Lanes whose upstream failed while another lane still published. Their own
   *  held rows carried across the write. */
  failures?: string[];
};

/** One refresh run with every dependency injectable, so the whole path can be
 *  executed in a test rather than only by spawning the CLI. */
export declare function runEventsRefresh(opts?: {
  argv?: string[];
  env?: Record<string, string | undefined>;
  nowMs?: number;
  fetchImpl?: typeof fetch;
  outPath?: string;
  loadVenueIndex?: () => unknown;
  runCommonLane?: (options: { nowMs: number; outPath: string }) => Promise<unknown>;
  openPr?: (input: {
    outPath: string;
    observedAt: string;
    nowMs: number;
    env: Record<string, string | undefined>;
  }) => void | Promise<void>;
  /** Runs before openPr; a throw refuses the PR. */
  validate?: () => void;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}): Promise<{
  ok: boolean;
  city: string | null;
  provider: EventsLaneReport;
  common: EventsLaneReport;
  validation: EventsLaneReport;
  /** Branch, commit, push and PR. Reports separately from validation. */
  published: EventsLaneReport;
}>;
