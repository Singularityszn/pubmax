import { expect, it } from "vitest";

import {
  defaultVenueKindVisibility,
  filterVenuesByKind,
  toggleVenueKind,
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

it("turns inherited Clubs off without hiding Bars", () => {
  const club = { id: "club", kind: "club" } as Venue;
  const bar = { id: "bar", kind: "bar" } as Venue;
  const legacyVisibility = {
    pub: true,
    bar: true,
    food: true,
    restaurant: true,
  };

  const next = toggleVenueKind(legacyVisibility, "club");

  expect(
    filterVenuesByKind([club, bar], next).map((venue) => venue.id),
  ).toEqual(["bar"]);
});
