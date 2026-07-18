// Hand-maintained declarations for eventsRefresh.mjs so the vitest suite
// (__tests__/whatsOnEvents.test.ts) type-checks under the repo's allowJs:false
// tsconfig. Keep in sync with the runtime module.

import type { VenueResolverIndex } from "./resolveVenueId.d.mts";

export type EventSource = { label: string; url: string };

export declare const TICKETMASTER_SOURCE: EventSource;
export declare const SKIDDLE_SOURCE: EventSource;

export declare const TICKETMASTER_SEGMENT_KIND: Record<string, "music" | "sport">;
export declare const SKIDDLE_EVENTCODE_KIND: Record<string, "music" | "sport">;

export type WhatsOnEventKind = "music" | "sport";

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
  source: EventSource;
  observedAt: string;
  confidence: "listed";
};

export type MapEventOpts = {
  observedAt: string;
  venueIndex?: VenueResolverIndex | null;
};

export declare function toIsoInstant(value: unknown): string | null;

export declare function mapTicketmasterEvent(
  event: unknown,
  opts?: MapEventOpts,
): WhatsOnEventRow | null;

export declare function normaliseTicketmasterEvents(
  payload: unknown,
  opts?: MapEventOpts,
): WhatsOnEventRow[];

export declare function mapSkiddleEvent(
  event: unknown,
  opts?: MapEventOpts,
): WhatsOnEventRow | null;

export declare function normaliseSkiddleEvents(
  payload: unknown,
  opts?: MapEventOpts,
): WhatsOnEventRow[];
