import type { VenueKind } from "@/lib/venues";
import { isPubVenueKind } from "@/lib/venueKindFilters";

// "Been here" is the undated list of pubs a person says they have been to
// (lib/beenHere.ts). It sits beside "Want to Visit" because the two are the
// pair a person keeps: where they mean to go and where they have been. It
// carries no visit date, so it is never a diary entry.
export const BUILT_IN_LIST_TYPES = [
  "Want to Visit",
  "Been here",
  "Cheap Pint",
  "Coding Pint",
  "Historic",
  "Date Night",
  "Crawl Stop",
  "Local Legend",
] as const;

export type BuiltInListType = (typeof BUILT_IN_LIST_TYPES)[number];

const BUILT_IN_LIST_TYPE_SET = new Set<string>(BUILT_IN_LIST_TYPES);
const PINT_SPECIFIC_LIST_TYPES = new Set<BuiltInListType>([
  "Cheap Pint",
  "Coding Pint",
]);

export function isBuiltInListType(
  value: unknown,
): value is BuiltInListType {
  return typeof value === "string" && BUILT_IN_LIST_TYPE_SET.has(value);
}

export function isListTypeEligibleForVenue(
  listType: string,
  kind: VenueKind | undefined,
): boolean {
  return (
    isPubVenueKind(kind) ||
    !PINT_SPECIFIC_LIST_TYPES.has(listType as BuiltInListType)
  );
}

export function eligibleBuiltInListTypes(
  kind: VenueKind | undefined,
): readonly BuiltInListType[] {
  return BUILT_IN_LIST_TYPES.filter((listType) =>
    isListTypeEligibleForVenue(listType, kind),
  );
}
