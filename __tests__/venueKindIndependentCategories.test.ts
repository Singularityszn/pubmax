import { expect, it } from "vitest";

import {
  defaultVenueKindVisibility,
  filterVenuesByKind,
} from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

it("keeps Clubs visible when Bars is switched off", () => {
  const club = { id: "club", kind: "club" } as Venue;
  const bar = { id: "bar", kind: "bar" } as Venue;
  const visibility = {
    ...defaultVenueKindVisibility(),
    club: true,
    bar: false,
  };

  expect(
    filterVenuesByKind([club, bar], visibility).map((venue) => venue.id),
  ).toEqual(["club"]);
});
