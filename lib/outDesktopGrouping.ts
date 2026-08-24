import type { OutOpenPlan } from "@/lib/out";
import { getNightArea } from "@/lib/nightAreas";
import { isNightAreaSlug } from "@/lib/nightPlanning";
import { outSourceAttribution, type OutSourceCredit } from "@/lib/out/attribution";
import type { OutVenueMatchStatus } from "@/lib/out/venueMatch";
import { outWindowNoun, type OutDayWindow } from "@/lib/outListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

/** One listed Open Crew is enough to make discovery useful at London MVP. */
export const OUT_OPEN_PLANS_MIN_SENDABLE = 1;

export const OUT_LISTING_PUB_ABSENT_LINE =
  "No matching pub in PUBMAXX yet.";

/** How many unlisted places the notice names before it counts the rest. */
export const OUT_UNMATCHED_PLACES_SHOWN = 6;

export type OutListingGroupKind = "venue" | "area" | "place";

export type OutListingGroup = {
  key: string;
  kind: OutListingGroupKind;
  label: string;
  rows: WhatsOnRow[];
};

export type OutListingPubPair =
  | {
      status: "matched";
      placeName: string;
      mapHref: string;
    }
  | {
      status: "absent";
      line: typeof OUT_LISTING_PUB_ABSENT_LINE;
    };

function normalizePlaceName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/** Return the one venue id form that Out links, groups, and counts may use. */
export function canonicalOutVenueId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const venueId = value.trim();
  return venueId.length > 0 ? venueId : null;
}

function hasResolvedPub(row: WhatsOnRow): boolean {
  return canonicalOutVenueId(row.venueId) !== null;
}

function areaGroupLabel(area: string): string {
  if (isNightAreaSlug(area)) return getNightArea(area).name;
  return area
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** The desktop group key prefers a resolved pub, then a night area, then the place name. */
export function outListingGroupKey(row: WhatsOnRow): {
  key: string;
  kind: OutListingGroupKind;
  label: string;
} {
  const venueId = canonicalOutVenueId(row.venueId);
  if (venueId) {
    return {
      key: `venue:${venueId}`,
      kind: "venue",
      label: row.placeName.trim() || venueId,
    };
  }
  if (typeof row.area === "string" && row.area.trim().length > 0) {
    const area = row.area.trim();
    return {
      key: `area:${area}`,
      kind: "area",
      label: areaGroupLabel(area),
    };
  }
  const place = normalizePlaceName(row.placeName);
  return {
    key: `place:${place}`,
    kind: "place",
    label: row.placeName.trim() || "Listing",
  };
}

function rowSortTime(row: WhatsOnRow): number {
  if (row.startsAt && Number.isFinite(Date.parse(row.startsAt))) {
    return Date.parse(row.startsAt);
  }
  if (row.startsDate && Number.isFinite(Date.parse(`${row.startsDate}T12:00:00.000Z`))) {
    return Date.parse(`${row.startsDate}T12:00:00.000Z`);
  }
  return Number.POSITIVE_INFINITY;
}

/** Desktop /out groups only listings that can open a PUBMAXX venue. */
export function groupOutListings(rows: readonly WhatsOnRow[]): OutListingGroup[] {
  const byKey = new Map<string, OutListingGroup>();
  for (const row of rows) {
    if (!hasResolvedPub(row)) continue;
    const descriptor = outListingGroupKey(row);
    const existing = byKey.get(descriptor.key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    byKey.set(descriptor.key, {
      key: descriptor.key,
      kind: descriptor.kind,
      label: descriptor.label,
      rows: [row],
    });
  }
  const groups = [...byKey.values()].map((group) => ({
    ...group,
    rows: [...group.rows].sort((left, right) => rowSortTime(left) - rowSortTime(right)),
  }));
  return groups.sort((left, right) => {
    const leftTime = Math.min(...left.rows.map(rowSortTime));
    const rightTime = Math.min(...right.rows.map(rowSortTime));
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.label.localeCompare(right.label, "en-GB");
  });
}

/** The pub beside a gig is the resolved venue on the row, or an honest absence. */
export function outListingPubPair(row: WhatsOnRow): OutListingPubPair {
  const venueId = canonicalOutVenueId(row.venueId);
  if (venueId) {
    return {
      status: "matched",
      placeName: row.placeName.trim() || venueId,
      mapHref: `/map?sel=${encodeURIComponent(venueId)}`,
    };
  }
  return { status: "absent", line: OUT_LISTING_PUB_ABSENT_LINE };
}

/** The page announces unmatched event listings once, not beside every row. */
export function outListingUnmatchedCount(rows: readonly WhatsOnRow[]): number {
  return rows.reduce(
    (count, row) =>
      hasResolvedPub(row) ? count : count + 1,
    0,
  );
}

export type OutUnmatchedNotice = {
  /** The count, and which night it is about. */
  line: string;
  /** The places, as the provider names them, ending in a full stop. */
  places: string;
  /** Who listed the hidden rows. Credit is owed whether or not a card shows. */
  credits: OutSourceCredit[];
  /** The one way onward. */
  way: { href: string; label: string };
};

function joinPlaces(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What the page says about the listings it is NOT showing.
 *
 * Every unmatched row is dropped from the pub list (groupOutListings), so
 * without this line an Out with four Ticketmaster rows at four arenas read as
 * an empty city under one word, "Some". The rule: say how many, say where,
 * credit who listed them, and hand the reader somewhere to go. The count is
 * about the HIDDEN rows alone, so with cards on screen it says "more".
 *
 * A match that could not RUN is a different finding from a place that is not
 * listed: the slim index failed to read, and the same four rows may well be at
 * pubs we list. That answer keeps the count and the names and drops the claim.
 *
 * Silent when nothing was hidden: with every row on a listed pub there is
 * nothing to say, and with no rows at all the status lines own the sentence.
 */
export function outUnmatchedListingsNotice(
  rows: readonly WhatsOnRow[],
  window: OutDayWindow,
  venueMatch: OutVenueMatchStatus | undefined,
): OutUnmatchedNotice | null {
  const hidden = rows.filter((row) => !hasResolvedPub(row));
  if (hidden.length === 0) return null;
  const shown = rows.length - hidden.length;
  const noun = outWindowNoun(window);
  // "at the weekend" reads as a phrase; "tonight" and "tomorrow" stand alone.
  const when = window === "weekend" ? `at ${noun}` : noun;
  const count = hidden.length;

  let line: string;
  if (venueMatch === "unavailable") {
    line = `We couldn't check which of ${noun === "the weekend" ? "the weekend's" : `${noun}'s`} ${count} ${
      count === 1 ? "listing is" : "listings are"
    } at a pub we list.`;
  } else if (count === 1) {
    line = `1 ${shown > 0 ? "more " : ""}listing ${when} is at a place we don't list yet.`;
  } else {
    line = `${count} ${shown > 0 ? "more " : ""}listings ${when} are at places we don't list yet.`;
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (const row of hidden) {
    const name = row.placeName.trim();
    const key = normalizePlaceName(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  const rest = names.length - OUT_UNMATCHED_PLACES_SHOWN;
  const named = names.slice(0, OUT_UNMATCHED_PLACES_SHOWN);
  const places =
    rest > 0
      ? `${named.join(", ")} and ${rest} more ${rest === 1 ? "place" : "places"}.`
      : `${joinPlaces(named)}.`;

  const way =
    window === "tonight"
      ? { href: "/tonight", label: "See what else is on tonight" }
      : { href: "/map", label: "Find a pub on the map" };

  return { line, places, credits: outSourceAttribution(hidden), way };
}

/** A sendable open plan carries a resolved meeting point the card can render. */
export function sendableOpenPlans(plans: readonly OutOpenPlan[]): OutOpenPlan[] {
  return plans.filter((plan) => plan.meetingPoint !== null);
}

/** Hide the whole section rather than show an empty card when the market is thin. */
export function outOpenPlansSectionVisible(plans: readonly OutOpenPlan[]): boolean {
  return sendableOpenPlans(plans).length >= OUT_OPEN_PLANS_MIN_SENDABLE;
}
