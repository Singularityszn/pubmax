// Three taps on Log it in one tick are ONE price (battle test D10).
//
// What the report found: three `el.click()` calls in one tick sent three
// `POST /api/price-submit`, all answered 201, and wrote three `pint_drops` rows
// 21 ms apart; the pub's sheet then listed "Report Pint Drop by bobpent" three
// times. The community price upserted once, so only the drop lane doubled.
//
// TWO defences, and each covers what the other cannot.
//
// The CLIENT LATCH is a ref claimed before the first await, because `submitting`
// is React state committed in a microtask after the event and all three taps
// read it false. It is pinned here by reading the source, for the reason
// AGENTS.md gives about server-painted controls: a rendered test of three
// synthetic clicks proves the harness more than it proves the latch, while the
// ref-before-await shape is the whole of what makes the latch work.
//
// The SERVER WINDOW is the one that survives a retry, a second tab and a lost
// response, none of which a latch in one browser can speak for.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  duplicateOneTapDrop,
  ONE_TAP_DUPLICATE_WINDOW_MS,
} from "@/lib/oneTapPintDrop.server";
import type { PintDrop } from "@/lib/pintDrops";

const NOW = Date.parse("2026-09-05T18:00:00.000Z");
const VENUE = "venue-a9nk2t";

function row(over: Partial<PintDrop> & { id: string }): PintDrop {
  return {
    id: over.id,
    venueId: VENUE,
    handle: "bobpent",
    drink: "Beer",
    priceGbp: 5.9,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: new Date(NOW - 21).toISOString(),
    ...over,
  };
}

const candidate = {
  venueId: VENUE,
  handle: "bobpent",
  priceGbp: 5.9,
  measure: "pint" as const,
};

describe("the duplicate-tap window", () => {
  it("reads the report's own burst as one tap", () => {
    // The rows landed 21 ms apart at venue-a9nk2t, one account, one figure.
    const first = row({ id: "burst-1", createdAt: new Date(NOW - 21).toISOString() });
    expect(duplicateOneTapDrop([first], candidate, NOW)?.id).toBe("burst-1");
  });

  it("answers with the FRESHEST matching row, so a third tap sees the second", () => {
    const rows = [
      row({ id: "burst-1", createdAt: new Date(NOW - 21).toISOString() }),
      row({ id: "burst-2", createdAt: new Date(NOW - 9).toISOString() }),
    ];
    expect(duplicateOneTapDrop(rows, candidate, NOW)?.id).toBe("burst-2");
  });

  it("lets an honest second report through once the window has passed", () => {
    const old = row({
      id: "earlier",
      createdAt: new Date(NOW - ONE_TAP_DUPLICATE_WINDOW_MS - 1).toISOString(),
    });
    expect(duplicateOneTapDrop([old], candidate, NOW)).toBe(null);
  });

  it("holds the boundary itself as a duplicate", () => {
    const edge = row({
      id: "edge",
      createdAt: new Date(NOW - ONE_TAP_DUPLICATE_WINDOW_MS).toISOString(),
    });
    expect(duplicateOneTapDrop([edge], candidate, NOW)?.id).toBe("edge");
  });

  it("is not a daily cap: a CORRECTION at a different figure still lands", () => {
    // The pairing lane takes several prices from one account at one pub in one
    // day on purpose. Only an exact repeat is refused.
    const other = row({ id: "different", priceGbp: 6.2 });
    expect(duplicateOneTapDrop([other], candidate, NOW)).toBe(null);
  });

  it("does not merge two different drinkers", () => {
    const someoneElse = row({ id: "alice", handle: "alicepent" });
    expect(duplicateOneTapDrop([someoneElse], candidate, NOW)).toBe(null);
  });

  it("does not merge two different pubs", () => {
    const elsewhere = row({ id: "other-pub", venueId: "venue-elsewhere" });
    expect(duplicateOneTapDrop([elsewhere], candidate, NOW)).toBe(null);
  });

  it("does not merge two different measures at one figure", () => {
    // £2.60 for a half and £2.60 for a pint are two observations, not one tap.
    const half = row({ id: "half", priceGbp: 2.6, measure: "half" });
    expect(
      duplicateOneTapDrop([half], { ...candidate, priceGbp: 2.6 }, NOW),
    ).toBe(null);
  });

  it("treats a row dated ahead of us as a clock, never a repeat", () => {
    const ahead = row({ id: "ahead", createdAt: new Date(NOW + 5_000).toISOString() });
    expect(duplicateOneTapDrop([ahead], candidate, NOW)).toBe(null);
  });

  it("says nothing about an unpriced row", () => {
    expect(
      duplicateOneTapDrop([row({ id: "note" })], { ...candidate, priceGbp: null }, NOW),
    ).toBe(null);
  });
});

describe("the client latch", () => {
  const source = readFileSync(
    join(process.cwd(), "components/map/VenuePriceSubmit.tsx"),
    "utf8",
  );

  it("claims a ref BEFORE the first await, not React state", () => {
    const claim = source.indexOf("logInFlight.current = true;");
    const firstAwait = source.indexOf("await requestContribution(");
    expect(claim).toBeGreaterThan(-1);
    expect(firstAwait).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(firstAwait);
  });

  it("guards on the ref rather than on the `submitting` flag", () => {
    // `submitting` still disables the button, which is the right thing for a
    // reader to SEE. What it cannot do is stop the second tap of one tick.
    expect(source).toContain("if (logInFlight.current) return;");
    expect(source).not.toContain("if (submitting || missionPending");
  });

  it("releases the latch whatever the outcome", () => {
    // A refused or failed write must leave the drinker able to try again, so
    // the release is a finally rather than a line on the happy path.
    expect(source).toMatch(/\}\s*finally\s*\{[\s\S]{0,200}?logInFlight\.current = false;/);
  });
});
