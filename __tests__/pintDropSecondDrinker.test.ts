// The second drinker's door, and what the write path says back (Fable51Fix
// section 1, 5 Sept 2026).
//
// The Hatton Overview says "Logged once, needs a second drinker" over a lone
// public £4.50. These cases hold the three pieces that turn that line into a
// path: the door's words and seed (`lib/pintDropSecondDrinker.ts`), the
// independence READING that names a same-reporter repeat as one
// (`readSecondReporter`), and the producer that mints once and answers the
// record on file to a retry (`runSecondReporterPass`).

import { beforeEach, describe, expect, it } from "vitest";

import { DAY_MS } from "@/lib/dayMs";
import { __resetPintDrops, addPintDrop, listVisiblePintDrops, type PintDrop } from "@/lib/pintDrops";
import {
  outcomeForUnmintedReading,
  readSecondReporter,
  type ConfirmableDrop,
} from "@/lib/pintDropConfirmation";
import { runSecondReporterPass } from "@/lib/pintDropConfirm.server";
import {
  confirmPintActionLabel,
  confirmPintActionName,
  confirmPintPriceSeed,
  confirmationOutcomeLine,
  parseConfirmationOutcome,
  SECOND_DRINKER_STATES,
  secondDrinkerDoorOffered,
} from "@/lib/pintDropSecondDrinker";
import { PINT_TRUST_STATES } from "@/lib/pintTrust";

const NOW = Date.parse("2026-09-05T20:00:00.000Z");
const VENUE = "venue-1vle947";

function drop(overrides: Partial<PintDrop> & { id: string }): PintDrop {
  return {
    venueId: VENUE,
    handle: "tester",
    drink: "Lager",
    priceGbp: 4.5,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: new Date(NOW - 3 * DAY_MS).toISOString(),
    ...overrides,
  } as PintDrop;
}

function candidates(...rows: PintDrop[]): ConfirmableDrop[] {
  return rows as unknown as ConfirmableDrop[];
}

describe("the door's words", () => {
  it("asks the question the landing asks, over the figure the lane prints", () => {
    expect(confirmPintActionLabel(4.5)).toBe("Still £4.50?");
    expect(confirmPintActionName(4.5, "The Sir Christopher Hatton")).toBe(
      "Confirm £4.50 a pint at The Sir Christopher Hatton",
    );
  });

  it("seeds the composer with the figure as its own field spells it", () => {
    expect(confirmPintPriceSeed(4.5)).toBe("4.50");
    expect(confirmPintPriceSeed(4)).toBe("4.00");
    expect(confirmPintPriceSeed(0)).toBeNull();
    expect(confirmPintPriceSeed(Number.NaN)).toBeNull();
    expect(confirmPintPriceSeed(null)).toBeNull();
  });
});

describe("where the door is offered", () => {
  it("is owed exactly to the two states that lack a second drinker, off the one trust reading", () => {
    for (const state of SECOND_DRINKER_STATES) expect(PINT_TRUST_STATES).toContain(state);
    expect(PINT_TRUST_STATES.filter(secondDrinkerDoorOffered)).toEqual(["logged-once", "aged-out"]);
    expect(secondDrinkerDoorOffered(null)).toBe(false);
  });
});

describe("the independence reading", () => {
  it("names a second authority key agreeing inside the window as the pair", () => {
    const reading = readSecondReporter(
      candidates(
        drop({ id: "first", authorityKey: "key-tester" }),
        drop({ id: "second", authorityKey: "key-other", createdAt: new Date(NOW).toISOString() }),
      ),
      NOW,
    );
    expect(reading.kind).toBe("pair");
  });

  it("names the same account repeating itself as one reporter, and confirms nothing", () => {
    const reading = readSecondReporter(
      candidates(
        drop({ id: "first", authorityKey: "key-tester" }),
        drop({ id: "again", authorityKey: "key-tester", createdAt: new Date(NOW).toISOString() }),
      ),
      NOW,
    );
    expect(reading).toEqual({ kind: "same_reporter" });
    expect(outcomeForUnmintedReading(reading as { kind: "same_reporter" })).toEqual({
      status: "same_reporter",
    });
  });

  it("does not call an unattributed row the same reporter, because it is no reporter", () => {
    // The production row at the Hatton carries no key (unlinked-handle door).
    // A keyed report beside it is the FIRST reporter, not a repeat.
    const reading = readSecondReporter(
      candidates(
        drop({ id: "unlinked" }),
        drop({ id: "keyed", authorityKey: "key-other", createdAt: new Date(NOW).toISOString() }),
      ),
      NOW,
    );
    expect(reading).toEqual({ kind: "awaiting" });
  });

  it("reads a live confirmation on file rather than looking for a new pair", () => {
    const confirmation = {
      confirmationId: "conf-1",
      confirmedAt: new Date(NOW - DAY_MS).toISOString(),
      basis: "second_reporter" as const,
      confirmingDropId: "second",
    };
    const reading = readSecondReporter(
      candidates(
        drop({ id: "first", authorityKey: "key-tester", confirmation }),
        drop({ id: "second", authorityKey: "key-other", confirmation }),
        drop({ id: "third", authorityKey: "key-third", createdAt: new Date(NOW).toISOString() }),
      ),
      NOW,
    );
    expect(reading).toEqual({ kind: "already_confirmed", confirmation });
  });

  it("keeps a disagreeing second key as awaiting, not as a repeat", () => {
    const reading = readSecondReporter(
      candidates(
        drop({ id: "first", authorityKey: "key-tester", priceGbp: 4.5 }),
        drop({ id: "second", authorityKey: "key-other", priceGbp: 6.9 }),
      ),
      NOW,
    );
    expect(reading).toEqual({ kind: "awaiting" });
  });
});

describe("the producer", () => {
  beforeEach(() => {
    __resetPintDrops();
  });

  it("mints once for two keys, stamping both rows with one id and the confirming drop", async () => {
    addPintDrop(drop({ id: "first", authorityKey: "key-tester" }));
    addPintDrop(
      drop({ id: "second", authorityKey: "key-other", createdAt: new Date(NOW).toISOString() }),
    );

    const outcome = await runSecondReporterPass(VENUE, NOW);
    expect(outcome.status).toBe("confirmed");
    if (outcome.status !== "confirmed") return;
    expect(outcome.confirmation.basis).toBe("second_reporter");
    // The peer is whichever row the corroboration lane did not lead with, so
    // only membership is pinned: the record names a drop of the pair.
    expect(["first", "second"]).toContain(outcome.confirmation.confirmingDropId);
    expect(new Set(outcome.dropIds)).toEqual(new Set(["first", "second"]));

    const rows = listVisiblePintDrops(VENUE);
    const ids = new Set(rows.map((row) => row.confirmation?.confirmationId));
    expect(ids).toEqual(new Set([outcome.confirmation.confirmationId]));
  });

  it("answers a retry with the confirmation on file, never a second id", async () => {
    addPintDrop(drop({ id: "first", authorityKey: "key-tester" }));
    addPintDrop(
      drop({ id: "second", authorityKey: "key-other", createdAt: new Date(NOW).toISOString() }),
    );
    const first = await runSecondReporterPass(VENUE, NOW);
    const retry = await runSecondReporterPass(VENUE, NOW + 1_000);
    expect(first.status).toBe("confirmed");
    expect(retry.status).toBe("already_confirmed");
    if (first.status !== "confirmed" || retry.status !== "already_confirmed") return;
    expect(retry.confirmation.confirmationId).toBe(first.confirmation.confirmationId);
  });

  it("says same reporter for one account twice, and writes no confirmation", async () => {
    addPintDrop(drop({ id: "first", authorityKey: "key-tester" }));
    addPintDrop(
      drop({ id: "again", authorityKey: "key-tester", createdAt: new Date(NOW).toISOString() }),
    );
    expect(await runSecondReporterPass(VENUE, NOW)).toEqual({ status: "same_reporter" });
    expect(listVisiblePintDrops(VENUE).every((row) => !row.confirmation)).toBe(true);
  });

  it("says awaiting over a lone report", async () => {
    addPintDrop(drop({ id: "first", authorityKey: "key-tester" }));
    expect(await runSecondReporterPass(VENUE, NOW)).toEqual({
      status: "awaiting_second_drinker",
    });
  });
});

describe("the answer on the wire", () => {
  const confirmation = {
    confirmationId: "conf-1",
    confirmedAt: "2026-09-05T20:00:00.000Z",
    basis: "second_reporter" as const,
    confirmingDropId: "second",
  };

  it("parses every status it knows and refuses the rest", () => {
    expect(
      parseConfirmationOutcome({ status: "confirmed", confirmation, dropIds: ["a", "b"] }),
    ).toEqual({ status: "confirmed", confirmation, dropIds: ["a", "b"] });
    expect(parseConfirmationOutcome({ status: "already_confirmed", confirmation })).toEqual({
      status: "already_confirmed",
      confirmation,
    });
    expect(parseConfirmationOutcome({ status: "same_reporter" })).toEqual({
      status: "same_reporter",
    });
    expect(parseConfirmationOutcome({ status: "confirmed" })).toBeNull();
    expect(parseConfirmationOutcome({ status: "green" })).toBeNull();
    expect(parseConfirmationOutcome(undefined)).toBeNull();
  });

  it("tells the drinker what their report did, and stays quiet where the receipt already says it", () => {
    expect(
      confirmationOutcomeLine({ status: "confirmed", confirmation, dropIds: [] }, 4.5),
    ).toBe("Two drinkers now agree on £4.50. Confirmed.");
    expect(confirmationOutcomeLine({ status: "same_reporter" }, 4.5)).toBe(
      "That matches your own earlier report, so it still needs a second drinker.",
    );
    expect(confirmationOutcomeLine({ status: "already_confirmed", confirmation }, 4.5)).toBe(
      "£4.50 was already confirmed here.",
    );
    expect(confirmationOutcomeLine({ status: "awaiting_second_drinker" }, 4.5)).toBeNull();
    expect(confirmationOutcomeLine({ status: "unavailable" }, 4.5)).toBeNull();
    expect(confirmationOutcomeLine(null, 4.5)).toBeNull();
  });
});
