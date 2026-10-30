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

it("defaults all ten venue kinds and shows only the five default-on kinds", () => {
  const visibility = defaultVenueKindVisibility();
  const venues = [
    { id: "pub", kind: "pub" },
    { id: "bar", kind: "bar" },
    { id: "club", kind: "club" },
    { id: "food", kind: "food" },
    { id: "restaurant", kind: "restaurant" },
    { id: "cafe", kind: "cafe" },
    { id: "hotel_lounge", kind: "hotel_lounge" },
    { id: "library", kind: "library" },
    { id: "coworking", kind: "coworking" },
    { id: "other", kind: "other" },
  ] as Venue[];

  expect(visibility).toStrictEqual({
    pub: true,
    bar: true,
    club: true,
    food: true,
    restaurant: true,
    cafe: false,
    hotel_lounge: false,
    library: false,
    coworking: false,
    other: false,
  });
  expect(
    filterVenuesByKind(venues, visibility).map((venue) => venue.kind),
  ).toEqual(["pub", "bar", "club", "food", "restaurant"]);
});
