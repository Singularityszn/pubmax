// The daytime answers /today is built from (design V1, 30 Oct 2026): somewhere
// to work, a coffee, lunch at a pub. Tonight owns the night; this page owns
// the day, so it carries none of Tonight's picks.
//
// Each module is composed on the SERVER for every night patch plus the
// central default, the same way the cheap-pints card is (./todayPints.ts), so
// the browser swaps to the reader's remembered area with no venue data of its
// own and no request. PURE and node-testable: the page reads the files and
// hands them in.
//
// No invented data. Every row names its source and its date. A patch with
// nothing to show is absent from its index, and a card with no rows renders
// nothing, never a zero.

import type { Route } from "next";

import {
  coffeePilotDrinkLabel,
  coffeePilotSourceLine,
  type CoffeePilotDrink,
  type CoffeePilotRow,
} from "@/lib/coffeePilot";
import { formatSnapshotFrom } from "@/lib/dataFreshness";
import { venueCheapestPintObservedAt } from "@/lib/drinks";
import { haversineKm } from "@/lib/haversine";
import { rankDeskNearMe, type DeskPoint } from "@/lib/nearDesk";
import { CENTRAL_PATCH, NIGHT_PATCHES, type NightPatch } from "@/lib/nightPatches";
import { isPublicRankablePub } from "@/lib/venueKindFilters";
import { venueMapUrl } from "@/lib/venueMapUrl";
import type { Venue } from "@/lib/venues";

/** Three rows a section: enough to choose from, short enough to read in a queue. */
export const TODAY_DAYTIME_ROWS = 3;

/** How far a lunch pub may be from the patch's heart: a short walk. */
export const TODAY_LUNCH_RADIUS_KM = 1.2;

const TODAY_PATCHES: readonly NightPatch[] = [...NIGHT_PATCHES, CENTRAL_PATCH];

/** A module answers for one patch; the index holds one per patch that has rows. */
type PatchModule<Row> = { patchId: string; areaLabel: string; rows: Row[] };

export type TodayWorkSpot = {
  id: string;
  name: string;
  kindLabel: string;
  /** "Wifi listed · Laptops welcome", known amenities only. */
  amenityLine: string;
  /** "Open till 18:00" and the like, or the honest unknown. */
  hoursCaption: string;
};

export type TodayWorkSpotsModule = PatchModule<TodayWorkSpot> & {
  /** "Checked 4 October 2026", the day the OpenStreetMap pack was cut. */
  checkedCaption: string;
};

export type TodayLunchPub = {
  id: string;
  name: string;
  mapHref: Route;
  menuUrl: string;
  /** The host that published the menu link, as a reader recognises it. */
  menuSource: string;
  /** "Records from 2 October 2026", the day the pub's listing was read. */
  readLine: string;
};

export type TodayLunchModule = PatchModule<TodayLunchPub>;

export type TodayCoffeeRow = {
  venueId: string;
  name: string;
  drinkLabel: string;
  priceGbp: number;
  sourceUrl: string;
  /** "Listed on crosstown.co.uk, 3 October 2026". */
  sourceLine: string;
};

export type TodayCoffeeModule = {
  /** The pilot's own area, said on the card so it never reads as all London. */
  areaLabel: string;
  rows: TodayCoffeeRow[];
};

export type TodayWorkSpotsIndex = Record<string, TodayWorkSpotsModule>;
export type TodayLunchIndex = Record<string, TodayLunchModule>;

export { todayPatchModule } from "./todayPatch";

/**
 * Work spots around every patch, ranked by the /near Work spots rule
 * (`rankDeskNearMe`): walkable first, then amenities, then open now. A patch
 * whose only answers sit beyond a walk is left out rather than stretched.
 */
export function buildTodayWorkSpotsIndex(
  venues: readonly DeskPoint[],
  observedAt: string | null,
  now: Date,
): TodayWorkSpotsIndex {
  const out: TodayWorkSpotsIndex = {};
  if (!observedAt) return out;
  for (const patch of TODAY_PATCHES) {
    const answer = rankDeskNearMe(patch.lat, patch.lng, [...venues], {
      now,
      observedAt,
      maxAnswers: TODAY_DAYTIME_ROWS,
    });
    if (answer.scope !== "walkable" || answer.cards.length === 0) continue;
    out[patch.id] = {
      patchId: patch.id,
      areaLabel: patch.label,
      checkedCaption: answer.cards[0]?.checkedCaption ?? "",
      rows: answer.cards.map((card) => ({
        id: card.id,
        name: card.name,
        kindLabel: card.kindLabel,
        amenityLine: card.amenityLines.join(" · "),
        hoursCaption: card.hoursCaption,
      })),
    };
  }
  return out;
}

/** The fields a menu link record carries that the lunch row reads. */
export type TodayMenuLink = { menuUrl?: string; source?: string };

function httpsUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Pubs for lunch around every patch: a pub whose listing says it serves food
 * AND that publishes a menu link we hold, nearest first. No food claim is made
 * beyond those two facts, and a pub whose listing carries no read day is left
 * out, because a lunch row without a date is a row we cannot stand behind.
 */
export function buildTodayLunchIndex(
  venues: readonly Venue[],
  menus: ReadonlyMap<string, TodayMenuLink>,
): TodayLunchIndex {
  const candidates = venues.flatMap((venue) => {
    if (!venue.amenities?.food || venue.retired) return [];
    if (!isPublicRankablePub(venue)) return [];
    if (!Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude)) return [];
    const record = menus.get(venue.id);
    const menuUrl = httpsUrl(record?.menuUrl);
    if (!menuUrl) return [];
    const readAt = venueCheapestPintObservedAt(venue);
    if (!readAt || !Number.isFinite(Date.parse(readAt))) return [];
    return [{ venue, menuUrl, menuSource: record?.source?.trim() || hostOf(menuUrl), readAt }];
  });
  const out: TodayLunchIndex = {};
  for (const patch of TODAY_PATCHES) {
    const rows = candidates
      .map((entry) => ({
        entry,
        km: haversineKm([patch.lng, patch.lat], [entry.venue.longitude, entry.venue.latitude]),
      }))
      .filter((item) => item.km <= TODAY_LUNCH_RADIUS_KM)
      .sort((a, b) => a.km - b.km)
      .slice(0, TODAY_DAYTIME_ROWS)
      .map(({ entry }) => ({
        id: entry.venue.id,
        name: entry.venue.name,
        mapHref: venueMapUrl(entry.venue.id),
        menuUrl: entry.menuUrl,
        menuSource: entry.menuSource,
        readLine: formatSnapshotFrom(new Date(entry.readAt)),
      }));
    if (rows.length > 0) out[patch.id] = { patchId: patch.id, areaLabel: patch.label, rows };
  }
  return out;
}

/** The pilot rows as the file names them, with the cafe's own name. */
export type TodayCoffeePilotRow = CoffeePilotRow & { venueName?: string };

/**
 * The cheapest listed flat white at each pilot cafe, cheapest first. Only the
 * one named drink is compared, because a flat white and a matcha latte are not
 * one "coffee" figure (lib/coffeePilot.ts). Null when the pilot lists none.
 */
export function buildTodayCoffee(
  rows: readonly TodayCoffeePilotRow[],
  areaLabel: string,
  drink: CoffeePilotDrink = "flat white",
): TodayCoffeeModule | null {
  const byCafe = new Map<string, TodayCoffeeRow>();
  for (const row of rows) {
    if (row.drink !== drink || !row.venueName) continue;
    if (!Number.isFinite(row.priceGbp) || row.priceGbp <= 0) continue;
    if (!httpsUrl(row.sourceUrl) || !/^\d{4}-\d{2}-\d{2}$/.test(row.observedAt)) continue;
    const held = byCafe.get(row.venueId);
    if (held && held.priceGbp <= row.priceGbp) continue;
    byCafe.set(row.venueId, {
      venueId: row.venueId,
      name: row.venueName,
      drinkLabel: coffeePilotDrinkLabel(drink),
      priceGbp: row.priceGbp,
      sourceUrl: row.sourceUrl,
      sourceLine: coffeePilotSourceLine(row),
    });
  }
  const sorted = [...byCafe.values()]
    .sort((a, b) => a.priceGbp - b.priceGbp || a.name.localeCompare(b.name))
    .slice(0, TODAY_DAYTIME_ROWS);
  return sorted.length > 0 ? { areaLabel, rows: sorted } : null;
}
