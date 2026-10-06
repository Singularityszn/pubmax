// ONE reading of "confirmed" (follow-up to #1440).
//
// Two modules were answering the same question from different evidence. The
// SERVER mints a confirmation over stored rows, where every drop carries its
// authority key. The BROWSER only ever sees the keys the public DTO publishes,
// and since #1440 an anonymous drop publishes none, because that key is a
// per-venue pseudonym and the same account's public drop at that pub carries
// the same key beside its real handle.
//
// So a pub the server had confirmed could still fail the browser's own
// corroboration re-derivation: the venue sheet read the minted confirmation and
// went green while the pin stayed grey over one pint. Conservative, and still
// two readings of one fact.
//
// `authoritativePriceDrop` (lib/venues.ts) is now the one reading: the minted
// confirmation first, the browser's re-derivation second and only as a
// fallback. These cases run the seam the way usePintDrops runs it - drops fold
// through `mergeVenueDrops`, the standing comes from `confirmedPriceInputFor`
// fed to `priceStandingFor`, and the pin is built by `pubsToGeoJSON`.

import { describe, expect, it } from "vitest";

import { pubsToGeoJSON } from "@/components/map/canvas/geojson";
import type { VenueSignal } from "@/components/map/canvas/types";
import {
  confirmedPriceInputFor,
  type ConfirmableDrop,
} from "@/lib/pintDropConfirmation";
import { priceStandingFor } from "@/lib/priceTier";
import {
  authoritativePriceDrop,
  confirmedPriceDrop,
  corroboratedPriceDrop,
  mergeVenueDrops,
  provisionalPriceDrop,
  type Venue,
} from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-04T20:00:00.000Z");
const YESTERDAY = new Date(NOW - DAY_MS).toISOString();
const VENUE_ID = "venue-1vle947";

function venue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: VENUE_ID,
    name: "The Sir Christopher Hatton",
    address: "4 Leather Lane",
    latitude: 51.52,
    longitude: -0.11,
    primaryBorough: "Camden",
    visibleBoroughs: [],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
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
    kind: "pub",
    ...overrides,
  } as Venue;
}

function drop(overrides: Partial<ConfirmableDrop> = {}): ConfirmableDrop {
  return {
    id: "drop-1",
    drink: "Lager",
    priceGbp: 4.5,
    passedDownNote: "",
    provenance: "contributor",
    createdAt: YESTERDAY,
    handle: "tester",
    ...overrides,
  };
}

/** A confirmation minted `ageDays` ago, as the server writes it. */
function confirmation(ageDays = 1, confirmingDropId = "drop-2") {
  return {
    confirmationId: "conf-1",
    confirmedAt: new Date(NOW - ageDays * DAY_MS).toISOString(),
    basis: "second_reporter" as const,
    confirmingDropId,
  };
}

/** The pair the server confirmed: one anonymous drop that publishes no key. */
function confirmedPair(): ConfirmableDrop[] {
  return [
    drop({
      handle: "Anonymous",
      // The anonymous row's key stays server-side (#1440), so the browser is
      // handed the confirmation and nothing it could re-derive one from.
      confirmation: confirmation(),
    }),
    drop({
      id: "drop-2",
      handle: "second_drinker",
      authorityKey: "account-second",
      createdAt: new Date(NOW - 2 * DAY_MS).toISOString(),
      confirmation: confirmation(),
    }),
  ];
}

const signals = new Map<string, VenueSignal>();
const pinFor = (v: Venue) =>
  pubsToGeoJSON([v], signals, null, null, null, null, null, null).features[0];

describe("the pin lane reads the server's confirmation", () => {
  it("takes a confirmed drop whose keys the browser never saw", () => {
    // The whole point: not one of these rows publishes an authority key, so the
    // browser's own corroboration finds nothing, and the confirmation still
    // speaks.
    const drops = [drop({ handle: "Anonymous", confirmation: confirmation() })];
    expect(corroboratedPriceDrop(drops, NOW)).toBeNull();
    expect(confirmedPriceDrop(drops, NOW)).not.toBeNull();
    expect(authoritativePriceDrop(drops, NOW)?.priceGbp).toBe(4.5);
  });

  it("paints that pub's figure on the pin and its price on the venue", () => {
    const [merged] = mergeVenueDrops(
      [venue()],
      new Map([[VENUE_ID, [drop({ handle: "Anonymous", confirmation: confirmation() })]]]),
      NOW,
    );
    expect(defined(merged).latestContributorPrice).toBe(4.5);
    expect(defined(merged).cheapestPrice).toBe(4.5);
    expect(defined(pinFor(defined(merged))).properties?.priceLabel).toBe("£4.50");
  });

  it("stands the standing green over it, through the one decider", () => {
    const drops = [drop({ handle: "Anonymous", confirmation: confirmation() })];
    const decision = priceStandingFor(
      { confirmed: confirmedPriceInputFor(drops, NOW) },
      NOW,
    );
    expect(decision.standing).toBe("confirmed");
    expect(decision.priceGbp).toBe(4.5);
  });

  it("offers no provisional figure beside it: one pub, one price", () => {
    const drops = [drop({ handle: "Anonymous", confirmation: confirmation() })];
    expect(provisionalPriceDrop(drops, NOW)).toBeNull();
  });

  it("confirms an anonymous drop paired with a public one from a second account", () => {
    const drops = confirmedPair();
    const [merged] = mergeVenueDrops([venue()], new Map([[VENUE_ID, drops]]), NOW);
    expect(authoritativePriceDrop(drops, NOW)).not.toBeNull();
    expect(defined(merged).latestContributorPrice).toBe(4.5);
    expect(
      priceStandingFor({ confirmed: confirmedPriceInputFor(drops, NOW) }, NOW).standing,
    ).toBe("confirmed");
  });
});

describe("what the confirmation lane still refuses", () => {
  it("leaves two unconfirmed drops with no keys provisional", () => {
    const drops = [
      drop({ handle: "tester" }),
      drop({
        handle: "second_drinker",
        createdAt: new Date(NOW - 2 * DAY_MS).toISOString(),
      }),
    ];
    expect(authoritativePriceDrop(drops, NOW)).toBeNull();
    expect(provisionalPriceDrop(drops, NOW)?.priceGbp).toBe(4.5);
    const [merged] = mergeVenueDrops([venue()], new Map([[VENUE_ID, drops]]), NOW);
    expect(defined(merged).latestContributorPrice).toBeNull();
    expect(defined(merged).cheapestPrice).toBeNull();
    expect(
      priceStandingFor({ confirmed: confirmedPriceInputFor(drops, NOW) }, NOW).standing,
    ).toBe("none");
  });

  it("keeps the browser re-derivation as the fallback for pre-0140 rows", () => {
    // Nothing minted a confirmation over these, and they still paint, because
    // the fallback can only ever ADD a pub the confirmation lane is silent
    // about. Removing it would un-paint pins that are correct today.
    const drops = [
      drop({ handle: "tester", authorityKey: "account-tester" }),
      drop({
        handle: "second_drinker",
        authorityKey: "account-second",
        createdAt: new Date(NOW - 2 * DAY_MS).toISOString(),
      }),
    ];
    expect(confirmedPriceDrop(drops, NOW)).toBeNull();
    expect(authoritativePriceDrop(drops, NOW)?.priceGbp).toBe(4.5);
  });

  it("falls through when the confirmation ages out, deleting nothing", () => {
    const drops = [drop({ handle: "Anonymous", confirmation: confirmation(90) })];
    expect(confirmedPriceDrop(drops, NOW)).toBeNull();
    expect(authoritativePriceDrop(drops, NOW)).toBeNull();
    expect(
      priceStandingFor({ confirmed: confirmedPriceInputFor(drops, NOW) }, NOW).standing,
    ).toBe("none");
    // The row is still there, and still says what the drinker paid.
    expect(defined(drops[0]).confirmation?.confirmationId).toBe("conf-1");
  });

  it("never lets a demo seed carry a confirmation onto the map", () => {
    const drops = [
      drop({ provenance: "demo", handle: "Anonymous", confirmation: confirmation() }),
    ];
    expect(confirmedPriceDrop(drops, NOW)).toBeNull();
    expect(authoritativePriceDrop(drops, NOW)).toBeNull();
  });

  it("ignores an unpriced drop however it was confirmed", () => {
    const drops = [drop({ priceGbp: null, confirmation: confirmation() })];
    expect(confirmedPriceDrop(drops, NOW)).toBeNull();
    expect(authoritativePriceDrop(drops, NOW)).toBeNull();
  });

  it("takes the freshest confirmation when a pub holds two", () => {
    const drops = [
      drop({ priceGbp: 4.5, confirmation: confirmation(10, "drop-a") }),
      drop({
        priceGbp: 5.2,
        handle: "third_drinker",
        createdAt: new Date(NOW - 3 * DAY_MS).toISOString(),
        confirmation: { ...confirmation(1, "drop-b"), confirmationId: "conf-2" },
      }),
    ];
    expect(confirmedPriceDrop(drops, NOW)?.priceGbp).toBe(5.2);
    expect(confirmedPriceInputFor(drops, NOW)?.priceGbp).toBe(5.2);
  });
});
