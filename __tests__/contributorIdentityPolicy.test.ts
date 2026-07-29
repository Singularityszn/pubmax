import { describe, expect, it } from "vitest";

import {
  RESERVED_CONTRIBUTOR_HANDLES,
  assessPubmaxxHandle,
} from "@/lib/pubmaxxIdentity";
import { assessContributionAge } from "@/lib/contributionEligibility";

describe("contributor handle policy", () => {
  it("keeps captain-reserved handles unavailable without treating them as taken", () => {
    expect(RESERVED_CONTRIBUTOR_HANDLES).toEqual([
      "karan",
      "sarah",
      "carol",
      "erin",
    ]);
    for (const handle of RESERVED_CONTRIBUTOR_HANDLES) {
      expect(assessPubmaxxHandle(handle)).toEqual({
        ok: false,
        reason: "reserved",
        error: "That handle is not available.",
      });
    }
    expect(assessPubmaxxHandle("karan_london")).toEqual({
      ok: true,
      handle: "karan_london",
    });
  });
});

describe("contribution age policy", () => {
  const NOW = Date.UTC(2026, 6, 29, 12);

  it("accepts someone on their eighteenth birthday", () => {
    expect(assessContributionAge("2008-07-29", NOW)).toEqual({
      ok: true,
      status: "adult",
    });
  });

  it("uses the London calendar at the midnight age boundary", () => {
    const shortlyAfterLondonMidnight = Date.UTC(2026, 6, 28, 23, 30);
    expect(
      assessContributionAge("2008-07-29", shortlyAfterLondonMidnight),
    ).toEqual({
      ok: true,
      status: "adult",
    });
  });

  it("retains only the eligibility date for someone one day under 18", () => {
    expect(assessContributionAge("2008-07-30", NOW)).toEqual({
      ok: true,
      status: "underage",
      eligibleOn: "2026-07-30",
    });
  });

  it.each([
    "",
    "29-07-2008",
    "2008-02-30",
    "2027-01-01",
    "1900-01-01",
  ])("rejects invalid or implausible date %s", (dateOfBirth) => {
    expect(assessContributionAge(dateOfBirth, NOW)).toEqual({
      ok: false,
      error: "Enter a valid date of birth.",
    });
  });
});
