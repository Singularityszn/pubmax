import type { OutOpenPlan } from "@/lib/out";
import { getNightArea } from "@/lib/nightAreas";
import { isNightAreaSlug } from "@/lib/nightPlanning";
import type { WhatsOnRow } from "@/lib/whatsOn";

/** One listed Open Crew is enough to make discovery useful at London MVP. */
export const OUT_OPEN_PLANS_MIN_SENDABLE = 1;

export const OUT_LISTING_PUB_ABSENT_LINE =
  "No matching pub in PUBMAXX yet.";

export const OUT_LISTING_UNMATCHED_LINE =
  "Some event listings are not linked to a PUBMAXX pub yet.";

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
  if (typeof row.venueId === "string" && row.venueId.length > 0) {
    return {
      key: `venue:${row.venueId}`,
      kind: "venue",
      label: row.placeName.trim() || row.venueId,
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

/** Desktop /out groups listings by venue first, then night area, then place name. */
export function groupOutListings(rows: readonly WhatsOnRow[]): OutListingGroup[] {
  const byKey = new Map<string, OutListingGroup>();
  for (const row of rows) {
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
  if (typeof row.venueId === "string" && row.venueId.length > 0) {
    return {
      status: "matched",
      placeName: row.placeName.trim() || row.venueId,
      mapHref: `/map?sel=${encodeURIComponent(row.venueId)}`,
    };
  }
  return { status: "absent", line: OUT_LISTING_PUB_ABSENT_LINE };
}

/** The page announces unmatched event listings once, not beside every row. */
export function outListingUnmatchedCount(rows: readonly WhatsOnRow[]): number {
  return rows.reduce(
    (count, row) =>
      typeof row.venueId === "string" && row.venueId.length > 0 ? count : count + 1,
    0,
  );
}

/** A sendable open plan carries a resolved meeting point the card can render. */
export function sendableOpenPlans(plans: readonly OutOpenPlan[]): OutOpenPlan[] {
  return plans.filter((plan) => plan.meetingPoint !== null);
}

/** Hide the whole section rather than show an empty card when the market is thin. */
export function outOpenPlansSectionVisible(plans: readonly OutOpenPlan[]): boolean {
  return sendableOpenPlans(plans).length >= OUT_OPEN_PLANS_MIN_SENDABLE;
}
