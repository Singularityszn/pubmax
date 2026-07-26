import { describe, expect, it } from "vitest";

import {
  defaultVenueKindVisibility,
  filterVenuesByKind,
  isPubVenue,
  toggleVenueKind,
} from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

const venue = (id: string, kind?: Venue["kind"]) =>
  ({ id, kind }) as Venue;

describe("venueKindFilters", () => {
  it("defaults every Wave 1 venue type on", () => {
    expect(defaultVenueKindVisibility()).toEqual({ pub: true, bar: true, food: true });
  });

  it("treats absent kind as a backward-compatible pub", () => {
    const visibility = toggleVenueKind(defaultVenueKindVisibility(), "pub");
    expect(filterVenuesByKind([venue("legacy"), venue("bar", "bar")], visibility))
      .toEqual([venue("bar", "bar")]);
  });

  it("toggles each kind independently", () => {
    const barsOff = toggleVenueKind(defaultVenueKindVisibility(), "bar");
    expect(barsOff).toEqual({ pub: true, bar: false, food: true });
    expect(filterVenuesByKind(
      [venue("pub"), venue("bar", "bar"), venue("food", "food")],
      barsOff,
    ).map((item) => item.id)).toEqual(["pub", "food"]);
  });

  it("does not leak future venue kinds into the Pints chip", () => {
    const futureKinds = [
      venue("club", "club"),
      venue("restaurant", "restaurant"),
    ];

    expect(filterVenuesByKind(futureKinds, defaultVenueKindVisibility())).toEqual(
      [],
    );
  });

  it("identifies only legacy and explicit pub venues for pint-domain consumers", () => {
    expect(
      [
        venue("legacy"),
        venue("pub", "pub"),
        venue("bar", "bar"),
        venue("food", "food"),
      ]
        .filter(isPubVenue)
        .map((item) => item.id),
    ).toEqual(["legacy", "pub"]);
  });
});
