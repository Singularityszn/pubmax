import { describe, expect, it } from "vitest";
import { hostedOutingEnrollment } from "@/lib/hostedOutings";

describe("hosted adult outing enrollment", () => {
  it("refuses enrollment until a venue and a named moderator are confirmed", () => {
    expect(hostedOutingEnrollment({
      venueConfirmed: false, moderatorActive: true, enrollmentEnabled: true,
      startsAt: "2027-01-01T18:00:00Z", status: "open",
    }, new Date("2026-10-29T12:00:00Z"))).toEqual({
      allowed: false, reason: "VENUE_UNCONFIRMED",
    });
  });
});

import { proposeHostedOutingGroup } from "@/lib/hostedOutings";

const gate = {
  venueConfirmed: true, moderatorActive: true, enrollmentEnabled: true,
  startsAt: "2027-01-01T18:00:00Z", status: "open" as const,
};
const now = new Date("2026-10-29T12:00:00Z");

it.each([
  [{ moderatorActive: false }, "MODERATOR_REQUIRED"],
  [{ enrollmentEnabled: false }, "ENROLLMENT_DISABLED"],
  [{ status: "cancelled" as const }, "OUTING_CLOSED"],
  [{ startsAt: "2026-01-01T18:00:00Z" }, "OUTING_CLOSED"],
])("refuses an outing when an enrollment prerequisite is absent", (change, reason) => {
  expect(hostedOutingEnrollment({ ...gate, ...change }, now)).toEqual({ allowed: false, reason });
});

it("allows an open future outing only after every enrollment prerequisite", () => {
  expect(hostedOutingEnrollment(gate, now)).toEqual({ allowed: true });
});

it("explains a deterministic group and excludes blocks before choosing members", () => {
  const proposal = proposeHostedOutingGroup({
    capacity: 3,
    candidates: [
      { profileId: "c", joinedAt: "2026-10-29T12:02:00Z", pace: "easy", budgetPence: 1500 },
      { profileId: "b", joinedAt: "2026-10-29T12:01:00Z", pace: "easy", budgetPence: 2000 },
      { profileId: "a", joinedAt: "2026-10-29T12:00:00Z", pace: "easy", budgetPence: 2500 },
      { profileId: "d", joinedAt: "2026-10-29T12:03:00Z", pace: "steady", budgetPence: 2000 },
    ],
    blockedPairs: [["b", "a"]],
  });
  expect(proposal.profileIds).toEqual(["a", "c"]);
  expect(proposal.budgetPence).toBe(1500);
  expect(proposal.explanation).toContain("Blocked pairs are excluded.");
});

it("does not propose a lone person or exceed capacity", () => {
  const candidates = ["a", "b", "c"].map((profileId) => ({
    profileId, joinedAt: "2026-10-29T12:00:00Z", pace: "easy" as const, budgetPence: 2000,
  }));
  expect(proposeHostedOutingGroup({ candidates, blockedPairs: [], capacity: 2 }).profileIds).toEqual(["a", "b"]);
  expect(proposeHostedOutingGroup({ candidates: candidates.slice(0, 1), blockedPairs: [], capacity: 2 }).profileIds).toEqual([]);
});

it("finds the earliest compatible group when the first signup has no partner", () => {
  const proposal = proposeHostedOutingGroup({ capacity: 3, blockedPairs: [], candidates: [
    { profileId: "a", joinedAt: "2026-10-29T12:00:00Z", pace: "steady", budgetPence: 2000 },
    { profileId: "b", joinedAt: "2026-10-29T12:01:00Z", pace: "easy", budgetPence: 1500 },
    { profileId: "c", joinedAt: "2026-10-29T12:02:00Z", pace: "easy", budgetPence: 2500 },
  ] });
  expect(proposal.profileIds).toEqual(["b", "c"]);
});

it("keeps approved attendees when it proposes a replacement from the waiting list", () => {
  const proposal = proposeHostedOutingGroup({ capacity: 2, blockedPairs: [], reservedProfileIds: ["c"], candidates: [
    { profileId: "a", joinedAt: "2026-10-29T12:00:00Z", pace: "steady", budgetPence: 2000 },
    { profileId: "b", joinedAt: "2026-10-29T12:01:00Z", pace: "easy", budgetPence: 1500 },
    { profileId: "c", joinedAt: "2026-10-29T12:02:00Z", pace: "easy", budgetPence: 2500 },
  ] });
  expect(proposal.profileIds).toEqual(["c", "b"]);
});
