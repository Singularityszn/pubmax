import type { Route } from "next";

import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import { drinkMeasureName, statedDrinkMeasure } from "@/lib/drinkMeasure";
import { londonDayKey } from "@/lib/pintContributions";
import { venueMapUrl as buildVenueMapUrl } from "@/lib/venueMapUrl";

// What the log in public day (lib/logInPublicDay.ts) shows: the day's real,
// priced, public Pint Drops from the public read, newest first.

/** Where the day's "log a pint" action goes: the map asks which pub first. */
export const LOG_IN_PUBLIC_HREF = "/map?log=1" as Route;

/** The public read the day lists. No credentials ride it, so only public drops come back. */
export const LOG_IN_PUBLIC_FEED_HREF = "/api/pint-drops?city=london";

const VENUE_FALLBACK_LABEL = "A London pub";
const PUBLIC_VISIBILITIES = new Set(["public", "anonymous"]);

/** "17 November 2026": the date the section stamps on itself. */
export function logInPublicDayLabel(day: string): string {
  return formatObservedDate(new Date(`${day}T12:00:00Z`));
}

const LONDON_CLOCK = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/London",
});

/** "19:05": the London wall-clock time a drop was logged. */
export function logInPublicTime(iso: string): string {
  return LONDON_CLOCK.format(new Date(iso));
}

export type LogInPublicDrop = {
  id: string;
  venueName: string;
  venueMapUrl: Route;
  drink: string;
  /** The serving the price is about, as the screen names it ("Pint", "Half"). */
  measure: string;
  priceGbp: number;
  createdAt: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pickOne(raw: unknown, day: string): LogInPublicDrop | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  const venueId = text(row.venueId);
  const createdAt = text(row.createdAt);
  const price = row.priceGbp;
  if (!id || !venueId || !createdAt) return null;
  if (row.provenance === "demo") return null;
  if (row.visibility !== undefined && !PUBLIC_VISIBILITIES.has(String(row.visibility))) return null;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
  if (londonDayKey(createdAt) !== day) return null;
  const serverLink = text(row.venueMapUrl);
  return {
    id,
    venueName: text(row.venueName) || VENUE_FALLBACK_LABEL,
    venueMapUrl: serverLink.startsWith("/map") ? (serverLink as Route) : buildVenueMapUrl(venueId),
    drink: text(row.drink),
    measure: drinkMeasureName(statedDrinkMeasure(row.measure), text(row.measureLabel)),
    priceGbp: price,
    createdAt,
  };
}

/**
 * The day's drops from a GET /api/pint-drops body, newest first.
 * Null means the body could not be read. An empty array means this response
 * contains no eligible drops, not that the day has none.
 */
export function pickLogInPublicDrops(body: unknown, day: string): LogInPublicDrop[] | null {
  if (!body || typeof body !== "object") return null;
  const list = (body as { drops?: unknown }).drops;
  if (!Array.isArray(list)) return null;
  return list
    .map((raw) => pickOne(raw, day))
    .filter((row): row is LogInPublicDrop => row !== null)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
