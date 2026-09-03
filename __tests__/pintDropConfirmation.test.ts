// The four behaviours a green trust pill rests on (#1354).
//
// Before this lane, `lib/pintIndex.ts` refused a `confirmed_pint_drop` source
// without a `confirmationId` and nothing in the tree minted one, so green was
// unreachable. These cases hold the producer to the rules ADR 0010 already set
// for a Community Price, read through the Pint Drop lane's own authority key.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DAY_MS } from "@/lib/dayMs";
import {
  confirmationIsLive,
  confirmedPriceInputFor,
  findSecondReporterConfirmation,
  liveConfirmationFor,
  isPintDropConfirmationBasis,
  type ConfirmableDrop,
} from "@/lib/pintDropConfirmation";
import { priceStandingFor } from "@/lib/priceTier";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";
import {
  confirmPintDropByModerator,
  confirmVenueBySecondReporter,
} from "@/lib/pintDropConfirm.server";

const NOW = Date.parse("2026-09-03T20:00:00.000Z");
const VENUE = "venue-confirm-1354";

function drop(overrides: Partial<PintDrop> & { id: string }): PintDrop {
  return {
    venueId: VENUE,
    handle: "karan",
    drink: "Pint",
    priceGbp: 4.2,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: new Date(NOW - DAY_MS).toISOString(),
    ...overrides,
  } as PintDrop;
}

function candidates(...rows: PintDrop[]): ConfirmableDrop[] {
  return rows as unknown as ConfirmableDrop[];
}

describe("second independent reporter", () => {
  it("confirms a price when a second authority key agrees inside the window", () => {
    const pair = findSecondReporterConfirmation(
      candidates(
        drop({ id: "a", authorityKey: "key-one", priceGbp: 4.2 }),
        drop({ id: "b", authorityKey: "key-two", priceGbp: 4.5 }),
      ),
      NOW,
    );
    expect(pair).not.toBeNull();
    expect(new Set([pair?.dropId, pair?.confirmingDropId])).toEqual(
      new Set(["a", "b"]),
    );
  });

  it("does not confirm when the same reporter logs twice", () => {
    // One account, two nights, the same figure. ADR 0010's whole point is
    // INDEPENDENCE, and a Pint Drop's independence is its authority key.
    expect(
      findSecondReporterConfirmation(
        candidates(
          drop({ id: "a", authorityKey: "key-one", priceGbp: 4.2 }),
          drop({
            id: "b",
            authorityKey: "key-one",
            priceGbp: 4.2,
            createdAt: new Date(NOW - 2 * DAY_MS).toISOString(),
          }),
        ),
        NOW,
      ),
    ).toBeNull();
  });

  it("does not confirm two unattributed reports", () => {
    // No authority key is no voice at all in this lane (migration 0117), which
    // is stricter than ADR 0010's single shared anonymous bucket and stays on
    // the safe side of it.
    expect(
      findSecondReporterConfirmation(
        candidates(drop({ id: "a" }), drop({ id: "b" })),
        NOW,
      ),
    ).toBeNull();
  });

  it("does not confirm a second report outside the tolerance", () => {
    expect(
      findSecondReporterConfirmation(
        candidates(
          drop({ id: "a", authorityKey: "key-one", priceGbp: 4.2 }),
          drop({ id: "b", authorityKey: "key-two", priceGbp: 7.5 }),
        ),
        NOW,
      ),
    ).toBeNull();
  });

  it("does not confirm when the agreeing report is over 30 days old", () => {
    expect(
      findSecondReporterConfirmation(
        candidates(
          drop({ id: "a", authorityKey: "key-one" }),
          drop({
            id: "b",
            authorityKey: "key-two",
            createdAt: new Date(NOW - 31 * DAY_MS).toISOString(),
          }),
        ),
        NOW,
      ),
    ).toBeNull();
  });

  it("does not re-mint over a venue that already holds a live confirmation", () => {
    expect(
      findSecondReporterConfirmation(
        candidates(
          drop({
            id: "a",
            authorityKey: "key-one",
            confirmation: {
              confirmationId: "held",
              confirmedAt: new Date(NOW - DAY_MS).toISOString(),
              basis: "second_reporter",
              confirmingDropId: "b",
            },
          }),
          drop({ id: "b", authorityKey: "key-two" }),
        ),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("a confirmation ages out", () => {
  it("stops answering as live past 30 days and reads grey", () => {
    const fresh = {
      confirmationId: "one",
      confirmedAt: new Date(NOW - 29 * DAY_MS).toISOString(),
      basis: "second_reporter" as const,
    };
    const aged = {
      confirmationId: "two",
      confirmedAt: new Date(NOW - 31 * DAY_MS).toISOString(),
      basis: "second_reporter" as const,
    };
    expect(confirmationIsLive(fresh, NOW)).toBe(true);
    expect(confirmationIsLive(aged, NOW)).toBe(false);

    const agedRow = candidates(drop({ id: "a", confirmation: aged }));
    expect(liveConfirmationFor(agedRow, NOW)).toBeNull();
    // The read seam answers null, so the ONE decider falls the pub through to
    // whatever weaker standing its own evidence supports rather than green.
    expect(confirmedPriceInputFor(agedRow, NOW)).toBeNull();
    expect(priceStandingFor({ confirmed: confirmedPriceInputFor(agedRow, NOW) }, NOW).standing).toBe(
      "none",
    );

    const freshRow = candidates(drop({ id: "a", priceGbp: 4.2, confirmation: fresh }));
    expect(confirmedPriceInputFor(freshRow, NOW)).toEqual({
      priceGbp: 4.2,
      observedAt: fresh.confirmedAt,
    });
    expect(priceStandingFor({ confirmed: confirmedPriceInputFor(freshRow, NOW) }, NOW)).toMatchObject(
      { standing: "confirmed", reason: "confirmed_in_window", priceGbp: 4.2 },
    );
  });

  it("reports the freshest live confirmation at the venue", () => {
    const older = new Date(NOW - 20 * DAY_MS).toISOString();
    const newer = new Date(NOW - 2 * DAY_MS).toISOString();
    expect(
      liveConfirmationFor(
        candidates(
          drop({
            id: "a",
            confirmation: { confirmationId: "old", confirmedAt: older, basis: "moderator" },
          }),
          drop({
            id: "b",
            confirmation: { confirmationId: "new", confirmedAt: newer, basis: "moderator" },
          }),
        ),
        NOW,
      ),
    ).toEqual({ confirmationId: "new", confirmedAtMs: Date.parse(newer) });
  });
});

describe("the minted record", () => {
  beforeEach(() => {
    __resetPintDrops();
    vi.restoreAllMocks();
  });

  it("mints one id across both drops of a confirmed pair", async () => {
    addPintDrop(drop({ id: "a", authorityKey: "key-one", priceGbp: 4.2 }));
    addPintDrop(drop({ id: "b", authorityKey: "key-two", priceGbp: 4.5 }));

    const confirmation = await confirmVenueBySecondReporter(VENUE, NOW);
    expect(confirmation?.basis).toBe("second_reporter");
    expect(confirmation?.confirmationId).toMatch(/[0-9a-f-]{36}/);
    expect(confirmation?.confirmingDropId).toBeTruthy();

    const { pintDropsStore } = await import("@/lib/pintDropsStore");
    const rows = await pintDropsStore().listConfirmationCandidates(VENUE);
    const ids = rows.map((row) => row.confirmation?.confirmationId);
    expect(ids).toEqual([confirmation?.confirmationId, confirmation?.confirmationId]);
  });

  it("does not mint a second confirmation for a third agreeing drinker", async () => {
    addPintDrop(drop({ id: "a", authorityKey: "key-one" }));
    addPintDrop(drop({ id: "b", authorityKey: "key-two" }));
    const first = await confirmVenueBySecondReporter(VENUE, NOW);
    addPintDrop(drop({ id: "c", authorityKey: "key-three" }));
    expect(await confirmVenueBySecondReporter(VENUE, NOW)).toBeNull();

    const { pintDropsStore } = await import("@/lib/pintDropsStore");
    const rows = await pintDropsStore().listConfirmationCandidates(VENUE);
    expect(rows.find((row) => row.id === "c")?.confirmation).toBeUndefined();
    expect(rows.find((row) => row.id === "a")?.confirmation?.confirmationId).toBe(
      first?.confirmationId,
    );
  });

  it("mints an id when a moderator confirms one drop, naming no peer", async () => {
    addPintDrop(drop({ id: "solo", authorityKey: "key-one" }));
    const confirmation = await confirmPintDropByModerator("solo", NOW);
    expect(confirmation?.basis).toBe("moderator");
    expect(confirmation?.confirmationId).toMatch(/[0-9a-f-]{36}/);
    expect(confirmation?.confirmingDropId).toBeUndefined();
    expect(isPintDropConfirmationBasis(confirmation?.basis)).toBe(true);
    // Already confirmed: a second moderator tap changes nothing.
    expect(await confirmPintDropByModerator("solo", NOW)).toBeNull();
    expect(await confirmPintDropByModerator("unknown-id", NOW)).toBeNull();
  });
});
