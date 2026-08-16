// Hand-maintained declarations for eventsRefresh.mjs so the vitest suite
// type-checks under the repo's allowJs:false tsconfig. Keep in sync with
// the runtime module.

import type { VenueResolverIndex } from "./resolveVenueId.d.mts";

export type EventSource = { label: string; url: string };

export declare const EVENT_REFRESH_CITIES: readonly string[];

export declare const TICKETMASTER_SOURCE: EventSource;
export declare const SKIDDLE_SOURCE: EventSource;

export declare const TICKETMASTER_SEGMENT_KIND: Record<string, "music" | "sport" | "event">;
export declare const SKIDDLE_EVENTCODE_KIND: Record<string, "music" | "sport" | "event">;

export type WhatsOnEventKind = "music" | "sport" | "event";

export type WhatsOnEventRow = {
  id: string;
  venueId?: string;
  placeName: string;
  lat?: number;
  lng?: number;
  kind: WhatsOnEventKind;
  startsAt: string;
  endsAt?: string;
  title: string;
  detail?: string;
  priceGbp?: number;
  imageUrl?: string;
  sourceId?: string;
  area?: string;
  source: EventSource;
  observedAt: string;
  confidence: "listed";
};

export type MapEventOpts = {
  observedAt: string;
  venueIndex?: VenueResolverIndex | null;
};

export type EventDropCounts = {
  noKind: number;
  noPlace: number;
  noStart: number;
  noUrl: number;
  noTitle: number;
  total: number;
};

export type NormalisedEvents = {
  rows: WhatsOnEventRow[];
  dropped: EventDropCounts;
};

export declare const EMPTY_EVENT_DROPS: Readonly<EventDropCounts>;

export declare function emptyEventDrops(): EventDropCounts;
export declare function summariseEventDrops(dropped: EventDropCounts): string;
export declare function providerLaneStatus(env?: Record<string, string | undefined>): {
  ticketmaster: "configured" | "not-configured";
  skiddle: "configured" | "not-configured";
};
export declare function eventsOutputPath(city?: string): string;
export declare function cityGeo(city?: string): {
  lat: number;
  lng: number;
  radiusMiles: number;
};
export declare function dedupeEventRowsBySourceId(rows: WhatsOnEventRow[]): WhatsOnEventRow[];
export declare function readExistingCommonRows(filePath: string): WhatsOnEventRow[];
export declare function parseEventsCityArg(argv?: string[]): string | null;

export declare function toIsoInstant(value: unknown): string | null;

export declare function mapTicketmasterEvent(
  event: unknown,
  opts?: MapEventOpts,
): WhatsOnEventRow | null;

export declare function normaliseTicketmasterEvents(
  payload: unknown,
  opts?: MapEventOpts,
): NormalisedEvents;

export declare function mapSkiddleEvent(
  event: unknown,
  opts?: MapEventOpts,
): WhatsOnEventRow | null;

export declare function normaliseSkiddleEvents(
  payload: unknown,
  opts?: MapEventOpts,
): NormalisedEvents;
