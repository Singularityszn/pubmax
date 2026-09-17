// A FAILED PINT DROP READ IS NOT A PUB WITH NO PRICE (review finding F-8).
//
// `refreshVenueDrops` answered a non-ok response and a rejection the same way:
// it wrote `[]` into the venue's entry. `/api/pint-drops` answers 503 whenever
// its store read throws, so one hiccup replaced a pub's real drops with
// nothing, `pintTrustFor([])` read `none`, and the Overview printed the
// first-drop nudge over a pub holding a confirmed price - the one sentence
// #1495 exists to keep off a public drop. The city-wide refresh 25 lines above
// it already did the right thing.
//
// The rule is a pure leaf so it can be held without mounting the map's whole
// hook, and the hook's own source is swept below so the failure path cannot
// grow a second answer.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  venueDropsAfterRead,
  type VenueDropReadStatus,
} from "@/lib/venueDropRead";
import {
  DROP_READ_UNAVAILABLE_LINE,
  firstDropNudgeMayClaimAbsence,
} from "@/lib/firstDropNudge";
import { pintTrustFor } from "@/lib/pintTrust";

const DROP = {
  id: "drop-1",
  venueId: "venue-xjf3n0",
  handle: "alice",
  drink: "Beer",
  measure: "pint" as const,
  priceGbp: 5.5,
  passedDownNote: "",
  era: "",
  provenance: "contributor" as const,
  status: "visible" as const,
  visibility: "public" as const,
  createdAt: new Date().toISOString(),
  authorityKey: "key-one",
};

describe("what a venue holds after a drop read", () => {
  it("keeps every row it had when the read could not be run", () => {
    expect(
      venueDropsAfterRead([DROP], { status: "unavailable" }),
    ).toEqual([DROP]);
  });

  it("leaves an unread venue unread rather than answering with nothing", () => {
    // `undefined` is "not asked"; `[]` is "asked, and this pub has none". A
    // failed read may not turn the first into the second.
    expect(venueDropsAfterRead(undefined, { status: "unavailable" })).toBeUndefined();
  });

  it("adopts an answer, including an empty one", () => {
    expect(venueDropsAfterRead([DROP], { status: "ready", drops: [] })).toEqual([]);
    expect(venueDropsAfterRead(undefined, { status: "ready", drops: [DROP] })).toEqual([
      DROP,
    ]);
  });

  it("is what keeps the pub's own trust state alive across a 503", () => {
    // The consequence the finding is really about: the drop that survives is
    // what stops `pintTrustFor` reading `none` over a pub with a public price.
    const kept = venueDropsAfterRead([DROP], { status: "unavailable" }) ?? [];
    expect(pintTrustFor(kept).state).not.toBe("none");
    expect(pintTrustFor([]).state).toBe("none");
  });
});

describe("what the price area may say about it", () => {
  it("claims an absence only when the read is not known to have failed", () => {
    const answers: Record<VenueDropReadStatus, boolean> = {
      idle: true,
      ready: true,
      unavailable: false,
    };
    for (const [status, mayClaim] of Object.entries(answers)) {
      expect(
        firstDropNudgeMayClaimAbsence(status as VenueDropReadStatus),
        `a ${status} read`,
      ).toBe(mayClaim);
    }
  });

  it("says the true thing instead, and never a dead end", () => {
    expect(DROP_READ_UNAVAILABLE_LINE).toMatch(/could not read/i);
    expect(DROP_READ_UNAVAILABLE_LINE).not.toMatch(/no (pint )?price/i);
  });

  it("prints that line and the one door where the nudge would have stood", () => {
    const source = readFileSync(
      join(process.cwd(), "components/map/inspector/VenueOverviewTab.tsx"),
      "utf8",
    );
    // ONE block tells the two absences apart, so no lane branch can grow a
    // second answer of its own.
    const start = source.indexOf("function UnpricedPubBlock(");
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("function VenuePriceSummary("));
    expect(block).toContain("firstDropNudgeMayClaimAbsence");
    expect(block).toContain("DROP_READ_UNAVAILABLE_LINE");
    // The way onward rides with BOTH, so a reader who came to log a price
    // still can (the friction rule in docs/VOICE.md).
    expect(block.match(/\{door\}/g) ?? []).toHaveLength(2);
  });
});

describe("the hook's failure path", () => {
  it("never writes an empty list into a venue it could not read", () => {
    const source = readFileSync(
      join(process.cwd(), "components/map/usePintDrops.ts"),
      "utf8",
    );
    const refresh = source.slice(
      source.indexOf("const refreshVenueDrops"),
      source.indexOf("// Pick a photo for one slot"),
    );
    expect(refresh).toContain("venueDropsAfterRead");
    // The exact shape the finding was made of.
    expect(refresh).not.toMatch(/next\.set\(\s*venueId\s*,\s*\[\]\s*\)/);
  });
});
