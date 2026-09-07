// THE VENUE TRUTH CONTRACT, table-driven over known / unknown / stale /
// restricted combinations.
//
// Every case here is one of the seven distinctions in
// `VENUE_TRUTH_DISTINCTIONS` said out loud. The three production readings that
// started this (Astra finding F03, `GET /api/venue/venue-p7p18j`, 6 September
// 2026) each appear as a named case, so the fix cannot silently come undone.

import { describe, expect, it } from "vitest";

import { canGroupGetIn, estimateBusyness, GET_IN_CHECK_LABEL } from "@/lib/busyness";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import { nightAreaForPoint } from "@/lib/pricedLanding";
import {
  AREA_CORE_RADIUS_FRACTION,
  amenityStatusFromValue,
  amenityStatusFromValues,
  areaClaimLabel,
  contactValueIsPublishable,
  derivedAmenityStatus,
  getInConfidence,
  getInMayClaimLikely,
  hardConstraintNotice,
  hardConstraintSatisfied,
  parseEmailAddress,
  parsePhoneNumber,
  venueAreaClaim,
  venueContactContract,
  VENUE_TRUTH_DISTINCTIONS,
  type AmenityStatus,
  type GetInEvidence,
} from "@/lib/venueTruth";

const LONDON_AREAS = NIGHT_AREAS.filter((area) => area.cityId === "london");

/** The Three Tuns at the LSE student centre, the venue the audit measured. */
const THREE_TUNS = { longitude: -0.117513, latitude: 51.5148 };

describe("the distinctions are named once", () => {
  it("keeps seven pairs, each with two states and a reason", () => {
    expect(VENUE_TRUTH_DISTINCTIONS).toHaveLength(7);
    for (const row of VENUE_TRUTH_DISTINCTIONS) {
      expect(row.states).toHaveLength(2);
      expect(row.states[0]).not.toBe(row.states[1]);
      expect(row.why.length).toBeGreaterThan(20);
    }
  });

  it("gives every distinction its own id", () => {
    const ids = VENUE_TRUTH_DISTINCTIONS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names the states this module really publishes", () => {
    const named = new Set(VENUE_TRUTH_DISTINCTIONS.flatMap((row) => [...row.states]));
    for (const state of ["unknown", "unavailable", "known-false", "inside", "nearby"]) {
      expect(named.has(state as never)).toBe(true);
    }
  });
});

describe("contacts: a column is published only when it parses", () => {
  const PHONE_CASES: Array<[label: string, raw: string, expected: string | null]> = [
    ["a plain London number", "020 7123 4567", "02071234567"],
    ["an international number", "+44 20 7123 4567", "+442071234567"],
    ["a bracketed number", "(020) 7123-4567", "02071234567"],
    ["an already-dialable value", "tel:02071234567", "02071234567"],
    ["THE PRODUCTION DEFECT: a website in the phone column", "🌐 https://www.lsesu.com/social/three-tuns/", null],
    ["a bare URL", "https://example.com/pub", null],
    ["an email", "hello@example.com", null],
    ["a blank", "", null],
    ["a note rather than a number", "call the bar", null],
    ["too few digits", "12345", null],
    ["too many digits", "1234567890123456", null],
  ];

  it.each(PHONE_CASES)("%s", (_label, raw, expected) => {
    expect(parsePhoneNumber(raw)).toBe(expected);
  });

  it("never builds a tel: href from a value it refused", () => {
    const contract = venueContactContract({
      phone: "🌐 https://www.lsesu.com/social/three-tuns/",
      website: "https://www.lsesu.com/social/three-tuns/",
    });
    expect(contract.phoneNumber).toBeNull();
    expect(contract.phoneHref).toBeNull();
    expect(contract.websiteHref).toBe("https://www.lsesu.com/social/three-tuns/");
  });

  it("builds a tel: href only from the digits it understood", () => {
    const contract = venueContactContract({ phone: "(020) 7123 4567" });
    expect(contract.phoneHref).toBe("tel:02071234567");
  });

  const EMAIL_CASES: Array<[raw: string, expected: string | null]> = [
    ["bar@example.com", "bar@example.com"],
    ["mailto:bar@example.com", "bar@example.com"],
    ["bar@example", null],
    ["not an email", null],
    ["two@@example.com", null],
    ["", null],
  ];
  it.each(EMAIL_CASES)("reads %s as an address or refuses it", (raw, expected) => {
    expect(parseEmailAddress(raw)).toBe(expected);
    expect(venueContactContract({ email: raw }).emailHref).toBe(
      expected === null ? null : `mailto:${expected}`,
    );
  });

  it("prefers https for a site and refuses a non-URL", () => {
    expect(venueContactContract({ website: "https://pub.example" }).websiteHref).toBe(
      "https://pub.example",
    );
    expect(venueContactContract({ website: "pub.example" }).websiteHref).toBeNull();
    expect(venueContactContract({ bookingLink: "" }).bookingHref).toBeNull();
  });

  it("answers whether one raw value may be published as its own kind", () => {
    expect(contactValueIsPublishable("phone", "020 7123 4567")).toBe(true);
    expect(contactValueIsPublishable("phone", "https://example.com")).toBe(false);
    expect(contactValueIsPublishable("email", "bar@example.com")).toBe(true);
    expect(contactValueIsPublishable("url", "https://example.com")).toBe(true);
    expect(contactValueIsPublishable("url", "020 7123 4567")).toBe(false);
  });
});

describe("amenities: blank is unknown, never false", () => {
  const CASES: Array<[raw: string, expected: AmenityStatus]> = [
    ["Yes", "known-true"],
    ["yes", "known-true"],
    ["y", "known-true"],
    ["true", "known-true"],
    ["1", "known-true"],
    ["yes (fri & sat)", "known-true"],
    ["yes sundays", "known-true"],
    ["No", "known-false"],
    ["none", "known-false"],
    ["false", "known-false"],
    ["", "unknown"],
    ["   ", "unknown"],
    ["Dog friendly", "unknown"],
    ["every day", "unknown"],
    // A value saying the question was NOT ANSWERED is unknown, never a stated
    // absence: the no-shaped alternative `n` used to match the `n` of "n/a",
    // because `/` is a word boundary, so "N/A" read as its own opposite.
    ["N/A", "unknown"],
    ["n/a", "unknown"],
    ["N/a", "unknown"],
    ["na", "unknown"],
    ["n.a.", "unknown"],
    ["Not applicable", "unknown"],
    ["unknown", "unknown"],
    ["TBC", "unknown"],
    ["-", "unknown"],
    ["?", "unknown"],
    // And the words that really do state an absence still do.
    ["no", "known-false"],
    ["no food", "known-false"],
    ["n", "known-false"],
    ["none at all", "known-false"],
  ];

  it.each(CASES)("reads %s as %s", (raw, expected) => {
    expect(amenityStatusFromValue(raw)).toBe(expected);
  });

  it("reads a missing value as unknown", () => {
    expect(amenityStatusFromValue(undefined)).toBe("unknown");
    expect(amenityStatusFromValue(null)).toBe("unknown");
  });

  it("lets a stated absence in one row stand while an N/A in another says nothing", () => {
    expect(amenityStatusFromValues(["N/A", "no"])).toBe("known-false");
    expect(amenityStatusFromValues(["N/A", ""])).toBe("unknown");
    expect(amenityStatusFromValues(["N/A", "Yes"])).toBe("known-true");
  });

  it("lets one stated presence answer for the whole group", () => {
    expect(amenityStatusFromValues(["", "Yes", ""])).toBe("known-true");
    expect(amenityStatusFromValues(["", "no", ""])).toBe("known-false");
    expect(amenityStatusFromValues(["", "", ""])).toBe("unknown");
    expect(amenityStatusFromValues(["no", "Yes"])).toBe("known-true");
    expect(amenityStatusFromValues([])).toBe("unknown");
  });

  it("never states an absence for a DERIVED amenity", () => {
    expect(derivedAmenityStatus(true)).toBe("known-true");
    expect(derivedAmenityStatus(false)).toBe("unknown");
  });

  it("satisfies a hard constraint only on a stated presence, and says so", () => {
    expect(hardConstraintSatisfied("known-true")).toBe(true);
    expect(hardConstraintSatisfied("unknown")).toBe(false);
    expect(hardConstraintSatisfied("known-false")).toBe(false);
    expect(hardConstraintNotice("step-free entrance")).toContain("step-free entrance");
    expect(hardConstraintNotice("alcohol-free")).toContain("have not checked");
  });
});

describe("getting in: a positive answer is gated on evidence", () => {
  const evidence = (over: Partial<GetInEvidence> = {}): GetInEvidence => ({
    openState: true,
    reportCount: 2,
    busynessSource: "community-report",
    ...over,
  });

  const CONFIDENCE_CASES: Array<[label: string, input: GetInEvidence, expected: string]> = [
    ["open door plus a fresh report", evidence(), "evidenced"],
    ["open door, nobody looked", evidence({ reportCount: 0, busynessSource: "typical-pattern" }), "pattern-only"],
    ["open door, a report count of zero on a report source", evidence({ reportCount: 0 }), "pattern-only"],
    ["THE PRODUCTION DEFECT: unknown hours, no reports", evidence({ openState: "unknown", reportCount: 0, busynessSource: "typical-pattern" }), "unknown"],
    ["unknown hours even with a report", evidence({ openState: "unknown" }), "unknown"],
    ["a closed door with a report", evidence({ openState: false }), "evidenced"],
  ];

  it.each(CONFIDENCE_CASES)("%s reads %s", (_label, input, expected) => {
    expect(getInConfidence(input)).toBe(expected);
  });

  it("only lets an evidenced answer claim likely", () => {
    expect(getInMayClaimLikely(evidence())).toBe(true);
    expect(getInMayClaimLikely(evidence({ reportCount: 0, busynessSource: "typical-pattern" }))).toBe(false);
    expect(getInMayClaimLikely(evidence({ openState: "unknown" }))).toBe(false);
  });

  it("answers the audited pub with unknown rather than likely", () => {
    // Production: fit "likely", "Two of you should get in fine, but no promises
    // on a Sunday", over isOpen "unknown" and reportCount 0.
    const answer = canGroupGetIn({
      groupSize: 2,
      level: "quiet",
      hasBookingLink: false,
      evidence: { openState: "unknown", reportCount: 0, busynessSource: "typical-pattern" },
    });
    expect(answer.fit).toBe("unknown");
    expect(answer.label).toBe(GET_IN_CHECK_LABEL);
    expect(answer.confidence).toBe("unknown");
    expect(answer.reason).not.toContain("should get in fine");
  });

  it("still refuses likely when the door is open but nobody looked", () => {
    const answer = canGroupGetIn({
      groupSize: 2,
      level: "quiet",
      hasBookingLink: false,
      evidence: { openState: true, reportCount: 0, busynessSource: "typical-pattern" },
    });
    expect(answer.fit).toBe("uncertain");
    expect(answer.label).toBe(GET_IN_CHECK_LABEL);
    expect(answer.confidence).toBe("pattern-only");
  });

  it("says likely once the door is known open and somebody looked", () => {
    const answer = canGroupGetIn({
      groupSize: 2,
      level: "quiet",
      hasBookingLink: false,
      evidence: { openState: true, reportCount: 1, busynessSource: "community-report" },
      now: new Date("2026-09-06T18:00:00Z"),
    });
    expect(answer.fit).toBe("likely");
    expect(answer.confidence).toBe("evidenced");
  });

  it("leaves the group-size answers alone whatever the evidence says", () => {
    const noEvidence = {
      openState: "unknown",
      reportCount: 0,
      busynessSource: "typical-pattern",
    } as const;
    expect(
      canGroupGetIn({ groupSize: 8, level: "busy", hasBookingLink: false, evidence: noEvidence }).fit,
    ).toBe("unlikely");
    expect(
      canGroupGetIn({ groupSize: 6, level: "rammed", hasBookingLink: true, evidence: noEvidence }).fit,
    ).toBe("book-ahead");
  });
});

describe("locality: an area's radius is how far it reaches, not where a pub is", () => {
  it("REGRESSION: the Three Tuns is near Piccadilly & Soho, not in it", () => {
    const claim = venueAreaClaim(THREE_TUNS, LONDON_AREAS);
    expect(claim.area?.slug).toBe("piccadilly-soho");
    expect(claim.relation).toBe("nearby");
    expect(areaClaimLabel(claim)).toBe("Near Piccadilly & Soho");
    // The measurement behind the rule: 0.87 of the area's own 1.4 km radius.
    expect(claim.distanceKm).toBeGreaterThan(1.2);
    expect(claim.distanceKm).toBeLessThan(1.25);
  });

  it("keeps the pub in the same area's LIST, which is what routing asks", () => {
    // The claim got weaker; nothing about which page lists the pub moved.
    expect(nightAreaForPoint(THREE_TUNS.longitude, THREE_TUNS.latitude)?.slug).toBe(
      "piccadilly-soho",
    );
  });

  it("calls a pub at the centre inside", () => {
    const soho = LONDON_AREAS.find((area) => area.slug === "piccadilly-soho");
    expect(soho).toBeDefined();
    const claim = venueAreaClaim(
      { longitude: soho!.centre.lng, latitude: soho!.centre.lat },
      LONDON_AREAS,
    );
    expect(claim.relation).toBe("inside");
    expect(areaClaimLabel(claim)).toBe(soho!.name);
  });

  const DISC = [
    { slug: "test-area", name: "Test Area", centre: { lat: 51.5, lng: -0.1 }, radiusKm: 2 },
  ];

  it("splits the disc at the core fraction", () => {
    // Straight north, so the distance is a clean latitude offset.
    const kmPerDegree = 110.574;
    const at = (km: number) => ({ longitude: -0.1, latitude: 51.5 + km / kmPerDegree });
    expect(venueAreaClaim(at(1.0), DISC).relation).toBe("inside");
    expect(venueAreaClaim(at(2 * AREA_CORE_RADIUS_FRACTION - 0.02), DISC).relation).toBe("inside");
    expect(venueAreaClaim(at(2 * AREA_CORE_RADIUS_FRACTION + 0.02), DISC).relation).toBe("nearby");
    expect(venueAreaClaim(at(1.9), DISC).relation).toBe("nearby");
    expect(venueAreaClaim(at(2.5), DISC).relation).toBe("unplaced");
  });

  it("says nothing about a point it cannot place", () => {
    const claim = venueAreaClaim({ longitude: 0, latitude: 0 }, LONDON_AREAS);
    expect(claim.relation).toBe("unplaced");
    expect(claim.area).toBeNull();
    expect(areaClaimLabel(claim)).toBeNull();
  });

  it("refuses a point that is not a point", () => {
    expect(venueAreaClaim({ longitude: Number.NaN, latitude: 51.5 }, LONDON_AREAS).relation).toBe(
      "unplaced",
    );
    expect(venueAreaClaim({ longitude: -0.1, latitude: Number.NaN }, LONDON_AREAS).relation).toBe(
      "unplaced",
    );
  });

  it("keeps the core fraction under one, or the distinction has no band", () => {
    expect(AREA_CORE_RADIUS_FRACTION).toBeGreaterThan(0);
    expect(AREA_CORE_RADIUS_FRACTION).toBeLessThan(1);
  });
});

describe("the combinations, end to end", () => {
  const NOW = new Date("2026-09-06T18:00:00Z");
  const HOURS = { 0: [{ opens: "12:00", closes: "23:00" }] };

  /**
   * KNOWN, UNKNOWN, STALE and RESTRICTED over one table. "Stale" is a door
   * report older than the busyness freshness window: it is dropped, so the
   * answer falls back to the clock and may not claim what a live report would.
   * "Restricted" is a large group, which is a real reading about the room and
   * is honest whatever the door evidence says.
   */
  const CASES: Array<{
    label: string;
    groupSize: number;
    hours?: typeof HOURS;
    reports?: Array<{ level: "quiet" | "rammed"; reportedAt: string }>;
    fit: string;
    confidence: string;
  }> = [
    {
      label: "known hours, fresh report, small group",
      groupSize: 2,
      hours: HOURS,
      reports: [{ level: "quiet", reportedAt: "2026-09-06T17:30:00Z" }],
      fit: "likely",
      confidence: "evidenced",
    },
    {
      label: "known hours, STALE report, small group",
      groupSize: 2,
      hours: HOURS,
      reports: [{ level: "quiet", reportedAt: "2026-09-06T14:00:00Z" }],
      fit: "uncertain",
      confidence: "pattern-only",
    },
    {
      label: "known hours, no report, small group",
      groupSize: 2,
      hours: HOURS,
      fit: "uncertain",
      confidence: "pattern-only",
    },
    {
      label: "UNKNOWN hours, no report, small group",
      groupSize: 2,
      fit: "unknown",
      confidence: "unknown",
    },
    {
      label: "UNKNOWN hours, fresh report, small group",
      groupSize: 2,
      reports: [{ level: "quiet", reportedAt: "2026-09-06T17:30:00Z" }],
      fit: "unknown",
      confidence: "unknown",
    },
    {
      label: "RESTRICTED: a group of eight at a rammed room, unknown hours",
      groupSize: 8,
      reports: [{ level: "rammed", reportedAt: "2026-09-06T17:30:00Z" }],
      fit: "unlikely",
      confidence: "unknown",
    },
    {
      label: "RESTRICTED: a group of six, known hours, fresh report",
      groupSize: 6,
      hours: HOURS,
      reports: [{ level: "quiet", reportedAt: "2026-09-06T17:30:00Z" }],
      fit: "uncertain",
      confidence: "evidenced",
    },
  ];

  it.each(CASES)("$label answers $fit / $confidence", (testCase) => {
    const busyness = estimateBusyness({
      now: NOW,
      timeZone: "Europe/London",
      openingHours: testCase.hours,
      reports: testCase.reports,
    });
    const answer = canGroupGetIn({
      groupSize: testCase.groupSize,
      level: busyness.level,
      hasBookingLink: false,
      evidence: {
        openState: busyness.isOpen,
        reportCount: busyness.reportCount,
        busynessSource: busyness.source,
      },
      now: NOW,
      timeZone: "Europe/London",
    });
    expect(answer.fit).toBe(testCase.fit);
    expect(answer.confidence).toBe(testCase.confidence);
    if (answer.fit !== "likely") expect(answer.reason).not.toContain("should get in fine");
  });

  it("keeps a stale report out of the count rather than ageing its wording", () => {
    const stale = estimateBusyness({
      now: NOW,
      timeZone: "Europe/London",
      openingHours: HOURS,
      reports: [{ level: "rammed", reportedAt: "2026-09-06T14:00:00Z" }],
    });
    expect(stale.reportCount).toBe(0);
    expect(stale.source).toBe("typical-pattern");
    expect(getInConfidence({
      openState: stale.isOpen,
      reportCount: stale.reportCount,
      busynessSource: stale.source,
    })).toBe("pattern-only");
  });
});
