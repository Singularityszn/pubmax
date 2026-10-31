import { describe, expect, it } from "vitest";

import {
  ALIGNED_ENTER_DEGREES,
  ALIGNED_LEAVE_DEGREES,
  bearingDegrees,
  bearingText,
  compassPointName,
  compassPriceLabel,
  distanceKm,
  headingFromOrientation,
  isAligned,
  NOT_ALIGNED,
  nextAlignment,
  nextNeedleRotation,
  normaliseDegrees,
  rankCompassTargets,
  relativeBearing,
  remeasureTarget,
  shouldRerank,
  smoothHeading,
  stepTarget,
  turnText,
  walkRadiusKm,
  type CompassVenue,
} from "@/lib/pintCompass";
import { nearPriceTrustLabel } from "@/lib/nearPriceTrust";

// Soho's night-patch centre, so the fixtures read as real streets.
const ORIGIN = { lat: 51.5136, lng: -0.1365 };
// About 111 m per 0.001 degree of latitude.
const north = (metres: number) => ({ lat: ORIGIN.lat + metres / 111_195, lng: ORIGIN.lng });
const east = (metres: number) => ({
  lat: ORIGIN.lat,
  lng: ORIGIN.lng + metres / (111_195 * Math.cos((ORIGIN.lat * Math.PI) / 180)),
});

function pub(id: string, point: { lat: number; lng: number }, price: number | null, extra: Partial<CompassVenue> = {}): CompassVenue {
  return { id, name: `The ${id}`, borough: "Westminster", cheapestPrice: price, ...point, ...extra };
}

describe("bearing and distance", () => {
  it("points north, east, south and west at the four quarters", () => {
    expect(bearingDegrees(ORIGIN, north(300))).toBeCloseTo(0, 3);
    expect(bearingDegrees(ORIGIN, east(300))).toBeCloseTo(90, 1);
    expect(bearingDegrees(ORIGIN, north(-300))).toBeCloseTo(180, 3);
    expect(bearingDegrees(ORIGIN, east(-300))).toBeCloseTo(270, 1);
  });

  it("reads a north-east pub at about 45 degrees", () => {
    const ne = { lat: north(400).lat, lng: east(400).lng };
    expect(bearingDegrees(ORIGIN, ne)).toBeGreaterThan(43);
    expect(bearingDegrees(ORIGIN, ne)).toBeLessThan(47);
  });

  it("answers 0 for the point you stand on rather than NaN", () => {
    expect(bearingDegrees(ORIGIN, ORIGIN)).toBe(0);
  });

  it("measures walking distance in kilometres", () => {
    expect(distanceKm(ORIGIN, north(800))).toBeCloseTo(0.8, 2);
  });

  it("turns a walk into a radius at the shared 4.8 km/h pace", () => {
    expect(walkRadiusKm(10)).toBeCloseTo(0.8, 6);
    expect(walkRadiusKm(5)).toBeCloseTo(0.4, 6);
    expect(walkRadiusKm(0)).toBe(0);
    expect(walkRadiusKm(Number.NaN)).toBe(0);
  });
});

describe("angles", () => {
  it("normalises any angle into [0, 360)", () => {
    expect(normaliseDegrees(-10)).toBe(350);
    expect(normaliseDegrees(370)).toBe(10);
    expect(normaliseDegrees(360)).toBe(0);
    expect(Object.is(normaliseDegrees(-360), 0)).toBe(true);
  });

  it("gives the signed turn from the heading to the pub", () => {
    expect(relativeBearing(10, 350)).toBe(20);
    expect(relativeBearing(350, 10)).toBe(-20);
    expect(relativeBearing(180, 0)).toBe(180);
    expect(relativeBearing(90, 90)).toBe(0);
  });

  it("never spins the long way round across north", () => {
    expect(nextNeedleRotation(350, 10)).toBe(370);
    expect(nextNeedleRotation(10, 350)).toBe(-10);
    expect(nextNeedleRotation(725, 0)).toBe(720);
    expect(nextNeedleRotation(Number.NaN, 400)).toBe(40);
  });

  it("enters the facing state inside its band and leaves only past the wider one", () => {
    expect(isAligned(ALIGNED_ENTER_DEGREES, false)).toBe(true);
    expect(isAligned(ALIGNED_ENTER_DEGREES + 1, false)).toBe(false);
    expect(isAligned(ALIGNED_LEAVE_DEGREES, true)).toBe(true);
    expect(isAligned(-(ALIGNED_LEAVE_DEGREES + 1), true)).toBe(false);
  });
});

describe("words for a direction", () => {
  it("names the eight winds", () => {
    expect(compassPointName(0)).toBe("north");
    expect(compassPointName(44)).toBe("north-east");
    expect(compassPointName(100)).toBe("east");
    expect(compassPointName(200)).toBe("south");
    expect(compassPointName(337.6)).toBe("north");
    expect(compassPointName(-90)).toBe("west");
  });

  it("writes the no-sensor fallback as a wind and a walk", () => {
    expect(bearingText({ bearing: 45, walkMinutes: 6 })).toBe("north-east, 6 min");
  });

  it("tells the reader which way to turn", () => {
    expect(turnText(3, true)).toBe("You are facing it.");
    expect(turnText(-40, false)).toBe("Turn left 40°.");
    expect(turnText(65.4, false)).toBe("Turn right 65°.");
    expect(turnText(170, false)).toBe("It is behind you. Turn round.");
  });
});

describe("the heading from a phone", () => {
  it("reads the iOS compass heading directly", () => {
    expect(headingFromOrientation({ webkitCompassHeading: 270, alpha: 12 })).toBe(270);
  });

  it("reads an absolute alpha as anticlockwise from north", () => {
    expect(headingFromOrientation({ alpha: 90, absolute: true })).toBe(270);
    expect(headingFromOrientation({ alpha: 0, absolute: true })).toBe(0);
  });

  it("refuses a relative alpha, which is not measured from north", () => {
    expect(headingFromOrientation({ alpha: 90, absolute: false })).toBeNull();
    expect(headingFromOrientation({ alpha: null, absolute: true })).toBeNull();
    expect(headingFromOrientation({})).toBeNull();
  });

  it("adds the screen's own rotation", () => {
    expect(headingFromOrientation({ webkitCompassHeading: 350 }, 90)).toBe(80);
  });
});

describe("ranking", () => {
  const venues = [
    pub("dear", north(200), 7.2, { priceSource: "Pint Prices", priceObservedAt: "2026-10-02" }),
    pub("cheap", east(500), 4.9, { priceSource: "Pint Prices", priceObservedAt: "2026-10-02" }),
    pub("cheapFar", north(-1400), 3.5),
    pub("tie", north(-300), 4.9),
    pub("unpriced", north(100), null),
    pub("bar", north(120), 2.5, { kind: "bar" }),
  ];

  it("answers the cheapest priced pub inside the walk first, nearer first on a tie", () => {
    const answer = rankCompassTargets(ORIGIN, venues, 10);
    expect(answer.widened).toBe(false);
    expect(answer.minutes).toBe(10);
    expect(answer.targets.map((target) => target.id)).toEqual(["tie", "cheap", "dear"]);
  });

  it("never offers a pub with no price, or a venue that is not a public pub", () => {
    const ids = rankCompassTargets(ORIGIN, venues, 15).targets.map((target) => target.id);
    expect(ids).not.toContain("unpriced");
    expect(ids).not.toContain("bar");
  });

  it("carries a bearing, a walk and the /near card's source line on every target", () => {
    const cheap = rankCompassTargets(ORIGIN, venues, 10).targets.find((target) => target.id === "cheap");
    expect(cheap?.bearing).toBeCloseTo(90, 0);
    expect(cheap?.walkMinutes).toBe(6);
    expect(cheap?.priceLabel).toBe(nearPriceTrustLabel("named", "Pint Prices", "2026-10-02"));
    expect(cheap?.priceLabel).toBe("On record · Pint Prices · read 2 Oct");
  });

  it("says when a price has no publisher rather than inventing one", () => {
    expect(compassPriceLabel({})).toBe("On record · Publisher not recorded");
    expect(compassPriceLabel({ priceSource: "  " })).toBe("On record · Publisher not recorded");
  });

  it("widens once, to twice the walk, when nothing is inside it", () => {
    const answer = rankCompassTargets(ORIGIN, [pub("far", north(1400), 5)], 10);
    expect(answer.widened).toBe(true);
    expect(answer.minutes).toBe(20);
    expect(answer.targets.map((target) => target.id)).toEqual(["far"]);
  });

  it("answers empty after one widening rather than widening again", () => {
    const answer = rankCompassTargets(ORIGIN, [pub("veryFar", north(5000), 5)], 10);
    expect(answer).toEqual({ targets: [], minutes: 20, widened: true });
  });

  it("is safe on an empty index", () => {
    expect(rankCompassTargets(ORIGIN, []).targets).toEqual([]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, index) => pub(`p${index}`, north(10 * index), 4 + index / 10));
    expect(rankCompassTargets(ORIGIN, many, 10, 3).targets).toHaveLength(3);
  });
});

describe("stepping through targets", () => {
  it("wraps both ways", () => {
    expect(stepTarget(0, 3, 1)).toBe(1);
    expect(stepTarget(2, 3, 1)).toBe(0);
    expect(stepTarget(0, 3, -1)).toBe(2);
    expect(stepTarget(5, 0, 1)).toBe(0);
  });
});

describe("walking towards a target", () => {
  const [target] = rankCompassTargets(ORIGIN, [pub("goal", north(600), 5)], 10).targets;
  if (!target) throw new Error("fixture pub missing");

  it("re-measures the chosen pub from the newest fix", () => {
    const halfway = remeasureTarget(north(300), target);
    expect(halfway.id).toBe("goal");
    expect(halfway.distanceKm).toBeCloseTo(0.3, 2);
    expect(halfway.walkMinutes).toBe(4);
    expect(halfway.bearing).toBeCloseTo(0, 2);
    // Walk past it and the needle turns round.
    expect(remeasureTarget(north(900), target).bearing).toBeCloseTo(180, 2);
  });

  it("reads the list again only after a real move", () => {
    expect(shouldRerank(null, ORIGIN)).toBe(true);
    expect(shouldRerank(ORIGIN, north(100))).toBe(false);
    expect(shouldRerank(ORIGIN, north(400))).toBe(true);
  });
});

describe("smoothing the heading", () => {
  it("takes the first reading as it is", () => {
    expect(smoothHeading(null, 370)).toBe(10);
  });

  it("follows the short way across north", () => {
    expect(smoothHeading(350, 10, 0.5)).toBe(0);
    expect(smoothHeading(10, 350, 0.5)).toBe(0);
    expect(smoothHeading(90, 180, 1)).toBe(180);
  });
});

describe("the facing state belongs to one pub", () => {
  it("holds inside the wider leave band for the same pub", () => {
    const facing = nextAlignment(NOT_ALIGNED, "a", 5);
    expect(facing).toEqual({ id: "a", aligned: true });
    expect(nextAlignment(facing, "a", ALIGNED_LEAVE_DEGREES - 2).aligned).toBe(true);
  });

  it("starts again on the next pub, so 15 degrees off is not facing it", () => {
    const facing = nextAlignment(NOT_ALIGNED, "a", 5);
    const off = ALIGNED_ENTER_DEGREES + 3;
    expect(off).toBeLessThan(ALIGNED_LEAVE_DEGREES);
    expect(nextAlignment(facing, "b", off)).toEqual({ id: "b", aligned: false });
  });

  it("is never facing without a heading or a pub", () => {
    const facing = nextAlignment(NOT_ALIGNED, "a", 0);
    expect(nextAlignment(facing, "a", null)).toEqual({ id: "a", aligned: false });
    expect(nextAlignment(facing, null, 0)).toEqual({ id: null, aligned: false });
  });
});
