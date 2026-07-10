import { describe, expect, it } from "vitest";

import { venueExternalActions } from "@/lib/venueExternalActions";
import type { Venue } from "@/lib/venues";

function venue(over: Partial<Venue> = {}): Venue {
  return {
    id: "venue-test",
    name: "The Test Arms",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.12,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: [],
    cheapestPrice: 5.5,
    cheapestPint: "Lager",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    ...over,
  };
}

describe("venueExternalActions", () => {
  it("returns nothing when no external URLs exist", () => {
    expect(venueExternalActions(venue())).toEqual([]);
  });

  it("surfaces Book a table when bookingLink is http(s)", () => {
    const actions = venueExternalActions(
      venue({ bookingLink: "https://book.example/table" }),
    );
    expect(actions).toEqual([
      {
        kind: "book",
        label: "Book a table",
        href: "https://book.example/table",
      },
    ]);
  });

  it("labels website as Look at the menu when the pub serves food", () => {
    const actions = venueExternalActions(
      venue({
        website: "https://pub.example/menu",
        amenities: { ...venue().amenities, food: true },
      }),
    );
    expect(actions).toEqual([
      {
        kind: "menu",
        label: "Look at the menu",
        href: "https://pub.example/menu",
      },
    ]);
  });

  it("labels website as Pub website when food is not flagged", () => {
    const actions = venueExternalActions(
      venue({ website: "https://pub.example/" }),
    );
    expect(actions[0]).toMatchObject({
      kind: "website",
      label: "Pub website",
    });
  });

  it("rejects non-http booking links", () => {
    expect(
      venueExternalActions(venue({ bookingLink: "javascript:alert(1)" })),
    ).toEqual([]);
  });
});
