// The Index publishes what drinkers confirmed, and nothing else (#1354).
//
// Every case here ends at `validatePintIndexSnapshot`, the admission rule this
// lane deliberately did not touch: if the producer and the validator ever
// disagree, the build dies rather than write a snapshot the site would refuse
// to read.

import { describe, expect, it } from "vitest";

import { validatePintIndexSnapshot, type LondonBoroughName } from "@/lib/pintIndex";
import {
  buildPintIndexSnapshotFromConfirmations,
  type ConfirmedDropRow,
  type IndexVenueFact,
} from "@/lib/pintIndexFromConfirmations";
import { LONDON_BOROUGH_CLASSIFIER_VERSION } from "@/lib/londonBoroughPoint.mjs";
import { defined } from "@/__tests__/helpers/defined";

const GENERATED_AT = "2026-09-30T09:00:00.000Z";
const SEEN_ON = "2026-09-02T20:00:00.000Z";
const CONFIRMED_ON = "2026-09-05T20:00:00.000Z";

const CLASSIFICATION = {
  version: LONDON_BOROUGH_CLASSIFIER_VERSION,
  method: "point_in_polygon" as const,
  sourceArtifact: "data/london_boroughs_simplified.json",
  licence: "Open Government Licence v3.0",
};

const VENUES = new Map<string, IndexVenueFact>([
  ["venue-crown", { name: "The Crown", lat: 51.54, lng: -0.14 }],
  ["venue-anchor", { name: "The Anchor", lat: 51.5, lng: -0.09 }],
]);

function confirmedDrop(overrides: Partial<ConfirmedDropRow> & { id: string }): ConfirmedDropRow {
  return {
    venueId: "venue-crown",
    priceGbp: 4.2,
    createdAt: SEEN_ON,
    confirmation: {
      confirmationId: "confirmation-1",
      confirmedAt: CONFIRMED_ON,
      basis: "second_reporter",
      confirmingDropId: "drop-b",
    },
    ...overrides,
  };
}

function build(
  drops: readonly ConfirmedDropRow[],
  classify: (lat: number, lng: number) => LondonBoroughName | null = () => "Camden",
  carriedExclusions?: Array<{ reason: string; observationCount: number; note: string }>,
) {
  return buildPintIndexSnapshotFromConfirmations({
    drops,
    venues: VENUES,
    classify,
    snapshotId: "london-pint-index-public-20260930-v1",
    generatedAt: GENERATED_AT,
    classification: CLASSIFICATION,
    publisher: "PUBMAXX",
    dropUrl: (dropId) => `https://pubmaxxing.com/p/${dropId}`,
    licence: null,
    carriedExclusions,
  });
}

describe("the September edition", () => {
  it("is non-empty as soon as one confirmation exists, and passes admission", () => {
    const built = build([confirmedDrop({ id: "drop-a" })]);

    expect(built.snapshot.status).toBe("published");
    expect(built.published).toBe(1);
    expect(validatePintIndexSnapshot(built.snapshot)).toMatchObject({ ok: true });

    const [source] = built.snapshot.sources;
    expect(source).toMatchObject({
      kind: "confirmed_pint_drop",
      reviewState: "confirmed",
      confirmationId: "confirmation-1",
      publisher: "PUBMAXX",
      sourceUrl: "https://pubmaxxing.com/p/drop-a",
    });

    const [observation] = built.snapshot.observations;
    expect(observation).toMatchObject({
      venueId: "venue-crown",
      pubName: "The Crown",
      boroughName: "Camden",
      boroughCode: "camden",
      pricePence: 420,
      sourceId: defined(source).id,
    });
  });

  it("dates a price to the night it was seen, never to the day it was confirmed", () => {
    const built = build([confirmedDrop({ id: "drop-a" })]);
    expect(built.snapshot.observations[0]?.observedAt).toBe(SEEN_ON);
    expect(built.snapshot.observations[0]?.observedAt).not.toBe(CONFIRMED_ON);
    expect(built.snapshot.observationWindow).toEqual({ start: SEEN_ON, end: SEEN_ON });
  });

  it("gives both drops of one pair their own observation under one confirmation id", () => {
    const built = build([
      confirmedDrop({ id: "drop-a" }),
      confirmedDrop({ id: "drop-b", venueId: "venue-anchor", priceGbp: 4.5 }),
    ]);
    expect(built.published).toBe(2);
    const confirmationIds = built.snapshot.sources.map((source) =>
      source.kind === "confirmed_pint_drop" ? source.confirmationId : null,
    );
    expect(new Set(confirmationIds)).toEqual(new Set(["confirmation-1"]));
    expect(built.snapshot.sources.map((source) => source.id)).toEqual([
      "drop-drop-a",
      "drop-drop-b",
    ]);
    expect(validatePintIndexSnapshot(built.snapshot)).toMatchObject({ ok: true });
  });
});

describe("what the Index refuses, and counts", () => {
  it("drops an unconfirmed report and an expired confirmation, each under its own reason", () => {
    const built = build([
      confirmedDrop({ id: "drop-none", confirmation: null }),
      confirmedDrop({
        id: "drop-old",
        confirmation: {
          confirmationId: "confirmation-old",
          confirmedAt: "2026-07-01T20:00:00.000Z",
          basis: "second_reporter",
        },
      }),
    ]);
    expect(built.snapshot.status).toBe("empty");
    expect(built.snapshot.observations).toEqual([]);
    expect(built.snapshot.observationWindow).toBeNull();
    expect(
      built.snapshot.excluded.find((row) => row.reason === "confirmation_not_live")
        ?.observationCount,
    ).toBe(2);
    expect(validatePintIndexSnapshot(built.snapshot)).toMatchObject({ ok: true });
  });

  it("drops a pub it cannot name and a point outside every borough, separately", () => {
    const built = build(
      [
        confirmedDrop({ id: "drop-unknown", venueId: "venue-nowhere" }),
        confirmedDrop({ id: "drop-outside", venueId: "venue-anchor" }),
        confirmedDrop({ id: "drop-unpriced", priceGbp: null }),
      ],
      (_lat, lng) => (lng === -0.09 ? null : "Camden"),
    );
    const reasons = Object.fromEntries(
      built.snapshot.excluded.map((row) => [row.reason, row.observationCount]),
    );
    expect(reasons).toMatchObject({
      venue_not_in_index: 1,
      venue_outside_london_boroughs: 1,
      price_not_recorded: 1,
    });
    expect(built.examined).toBe(3);
    expect(built.published).toBe(0);
  });

  it("keeps the exclusions that are true of the whole Index", () => {
    const carried = [
      {
        reason: "source_not_eligible_for_public_index",
        observationCount: 2796,
        note: "Legacy competitor-derived baseline remains quarantined from this citable snapshot.",
      },
    ];
    const built = build([confirmedDrop({ id: "drop-a" })], () => "Camden", carried);
    expect(built.snapshot.excluded[0]).toEqual(carried[0]);
    expect(validatePintIndexSnapshot(built.snapshot)).toMatchObject({ ok: true });
  });
});
