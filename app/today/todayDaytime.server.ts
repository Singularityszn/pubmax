import "server-only";

// The two committed packs /today's daytime modules read, opened on the server
// so no reader downloads either. Both are STATIC imports: the bundler carries
// the bytes into the function that renders the page, so an ISR re-render on the
// deployment reads the same files the build did, with no file-tracing entry to
// keep in step.
//
// Read-only reuse. The desk pack is the /near Work spots pack and its parser
// (lib/nearDeskVenues.ts); the coffee rows are the Shoreditch pilot the map's
// coffee lens reads (lib/coffeePilotLoader.ts). Nothing here re-ranks or
// re-words either: that is ./todayDaytime.ts.

import coffeePilot from "@/data/coffee_pilot/shoreditch.json";
import deskPack from "@/public/data/london_desks/desks.json";
import { parseDeskPack, type DeskVenueLoad } from "@/lib/nearDeskVenues";

import type { TodayCoffeePilotRow } from "./todayDaytime";

/** The Work spots pack, parsed by its own reader. A bad pack is `failed`. */
export function loadTodayDeskPack(): DeskVenueLoad {
  try {
    return parseDeskPack(deskPack as unknown);
  } catch {
    return { status: "failed", venues: [], observedAt: null, source: "osm" };
  }
}

/** The coffee pilot's hand-checked rows, or none when the file is malformed. */
export function loadTodayCoffeePilot(): TodayCoffeePilotRow[] {
  const rows = (coffeePilot as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as TodayCoffeePilotRow[]) : [];
}
