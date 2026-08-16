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
  summariseEventDrops,
  toIsoInstant,
} from "../../lib/whatson/eventNormalise.d.mts";

export declare function providerLaneStatus(env?: Record<string, string | undefined>): {
  ticketmaster: "configured" | "not-configured";
  skiddle: "configured" | "not-configured";
};
export declare function eventsOutputPath(city?: string): string;
export declare function readExistingCommonRows(
  filePath: string,
): import("../../lib/whatson/eventNormalise.d.mts").WhatsOnEventRow[];
export declare function parseEventsCityArg(argv?: string[]): string | null;
