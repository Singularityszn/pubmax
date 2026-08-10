// Who may be offered a handle.
//
// "Claim this handle" is an offer about an EMPTY handle. It used to ride on the
// viewer alone: any signed-out visitor met it, including on a profile carrying
// a face, a bio and a founding number, and taking it wrote that handle onto
// their device (`pubmax_handle`) and opened the edit surface. So the offer is
// now made on evidence, and the evidence is TRI-STATE for the same reason
// `identityResolved` and `useViewerHandle` are: "we asked and nobody owns this"
// and "we could not ask" are two different answers, and only one of them may be
// acted on.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { handleIsAdoptable, type PublicProfile } from "@/lib/profiles";

const OWNER: PublicProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  handle: "karan",
  displayName: "Karan Manoharan",
  foundingMemberNumber: 1,
  createdAt: "2026-06-01T12:00:00.000Z",
  updatedAt: "2026-08-10T09:00:00.000Z",
};

describe("handleIsAdoptable", () => {
  it("offers a handle the public read answered about and nobody owns", () => {
    expect(
      handleIsAdoptable({ read: "answered", ownerProfile: null, tombstoned: false }),
    ).toBe(true);
  });

  it("never offers a handle that has an owner", () => {
    expect(
      handleIsAdoptable({ read: "answered", ownerProfile: OWNER, tombstoned: false }),
    ).toBe(false);
  });

  it("never offers a handle before the read has answered", () => {
    // The whole defect in one case: at first paint `stored` is null for EVERY
    // handle, so a check on the row alone would flash the offer under somebody
    // else's name on the way to the truth.
    expect(
      handleIsAdoptable({ read: "asking", ownerProfile: null, tombstoned: false }),
    ).toBe(false);
  });

  it("never offers a handle when the read failed", () => {
    expect(
      handleIsAdoptable({ read: "failed", ownerProfile: null, tombstoned: false }),
    ).toBe(false);
  });

  it("never offers a tombstoned handle, whose number stays spent", () => {
    // A founder who left keeps their number and leaves the wall; recycling the
    // handle would mean the same mark named two people.
    expect(
      handleIsAdoptable({ read: "answered", ownerProfile: null, tombstoned: true }),
    ).toBe(false);
  });
});

describe("the profile page asks that question rather than its own", () => {
  const source = readFileSync(
    join(process.cwd(), "app/u/[handle]/ProfilePageClient.tsx"),
    "utf8",
  );

  it("gates the claim button on the shared predicate", () => {
    expect(source).toContain("handleIsAdoptable(");
    // The claim branch names the guard; a branch on the viewer alone is what
    // shipped the offer under an owner's face.
    expect(source).toMatch(
      /isAnonymous && !isYouRoute && canAdoptHandle \? \(/,
    );
  });

  it("keeps the read's own state, not just its answer", () => {
    // `stored` says WHAT the read found; `publicRead` says whether it found
    // anything out at all. Collapsing the two is the defect this fence exists
    // to catch.
    expect(source).toContain("setPublicRead(outcome === \"failed\" ? \"failed\" : \"answered\")");
  });
});
