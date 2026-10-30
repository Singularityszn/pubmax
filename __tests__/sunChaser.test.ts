import { describe, expect, it } from "vitest";
import { sunPosition } from "@/lib/weatherDaylight";
import {
  buildSunTimeline,
  estimateSun,
  prepareSunSurroundings,
  segmentAt,
  sunHeadline,
  sunSkyNote,
  sunStateAt,
  SUN_ESTIMATE_CAVEAT,
  type LngLat,
  type SunBuilding,
} from "@/lib/sunChaser";

// Trafalgar Square, near enough central London for the reference values.
const LONDON: LngLat = [-0.1278, 51.5074];

// Reference values from the NOAA solar calculator equations (no refraction),
// worked independently of SunCalc. SunCalc agrees to within a quarter degree.
const NOAA_REFERENCE: Array<[string, number, number]> = [
  ["2026-06-21T12:00:00Z", 178.86, 61.93],
  ["2026-06-21T06:00:00Z", 74.48, 17.8],
  ["2026-06-21T17:30:00Z", 279.16, 23.06],
  ["2026-12-21T12:00:00Z", 180.34, 15.05],
  ["2026-03-20T09:00:00Z", 126.18, 25.04],
  ["2026-10-30T14:00:00Z", 214.83, 18.24],
];

describe("sunPosition", () => {
  it.each(NOAA_REFERENCE)("matches NOAA over London at %s", (iso, azimuth, altitude) => {
    const position = sunPosition(LONDON[1], LONDON[0], new Date(iso));
    expect(position).not.toBeNull();
    expect(Math.abs(position!.azimuthDeg - azimuth)).toBeLessThan(0.35);
    expect(Math.abs(position!.altitudeDeg - altitude)).toBeLessThan(0.35);
  });

  it("puts the sun below the horizon at London midnight", () => {
    expect(sunPosition(LONDON[1], LONDON[0], new Date("2026-06-21T23:30:00Z"))!.altitudeDeg).toBeLessThan(0);
  });

  it("answers null for an unusable point or instant", () => {
    expect(sunPosition(Number.NaN, 0, new Date())).toBeNull();
    expect(sunPosition(91, 0, new Date())).toBeNull();
    expect(sunPosition("51.5", 0, new Date())).toBeNull();
    expect(sunPosition(51.5, 0, new Date("not a date"))).toBeNull();
  });
});

/** A box `width` by `depth` metres whose near edge is `distance` metres from the pub along a bearing. */
function box(bearingDeg: number, distance: number, heightM: number | null, width = 40, depth = 10): SunBuilding {
  const cosLat = Math.cos((LONDON[1] * Math.PI) / 180);
  const toLngLat = (x: number, y: number): LngLat => [
    LONDON[0] + x / (111_320 * cosLat),
    LONDON[1] + y / 110_540,
  ];
  const b = (bearingDeg * Math.PI) / 180;
  const along = { x: Math.sin(b), y: Math.cos(b) };
  const across = { x: Math.cos(b), y: -Math.sin(b) };
  const corner = (d: number, w: number) => toLngLat(along.x * d + across.x * w, along.y * d + across.y * w);
  return {
    rings: [[corner(distance, -width / 2), corner(distance, width / 2), corner(distance + depth, width / 2), corner(distance + depth, -width / 2)]],
    heightM,
  };
}

/** The pub's own footprint, with the mapped point inside it. */
const OWN_PUB = box(0, -6, 12, 12, 12);
const JUNE_NOON = new Date("2026-06-21T12:00:00Z");
const DECEMBER_NOON = new Date("2026-12-21T12:00:00Z");

function stateWith(buildings: SunBuilding[], at: Date) {
  const surroundings = prepareSunSurroundings(LONDON, [OWN_PUB, ...buildings]);
  expect(surroundings).not.toBeNull();
  return sunStateAt(surroundings!, at);
}

describe("shadow test", () => {
  it("is in shade behind a tall block to the south at noon", () => {
    expect(stateWith([box(180, 10, 40)], JUNE_NOON)).toBe("shade");
  });

  it("is in sun when the tall block is to the north", () => {
    expect(stateWith([box(0, 10, 40)], JUNE_NOON)).toBe("sun");
  });

  it("is in sun past a short wall in high summer, and in its shade in winter", () => {
    const lowBlock = box(180, 20, 8);
    expect(stateWith([lowBlock], JUNE_NOON)).toBe("sun");
    expect(stateWith([lowBlock], DECEMBER_NOON)).toBe("shade");
  });

  it("skips the pub's own footprint, because the garden side is not recorded", () => {
    expect(stateWith([], DECEMBER_NOON)).toBe("sun");
  });

  it("answers unknown, never sun, when a building with no height stands in the ray", () => {
    expect(stateWith([box(180, 10, null)], JUNE_NOON)).toBe("unknown");
    expect(stateWith([box(0, 10, null)], JUNE_NOON)).toBe("sun");
  });

  it("answers set after sunset", () => {
    expect(stateWith([], new Date("2026-06-21T22:00:00Z"))).toBe("set");
  });

  it("finds no surroundings when no building is near enough to prove the tiles hold data", () => {
    expect(prepareSunSurroundings(LONDON, [box(90, 400, 20)])).toBeNull();
    expect(prepareSunSurroundings(LONDON, [])).toBeNull();
  });
});

describe("timeline and words", () => {
  // A 15 m block 15 m to the west: sun at lunch, shade as the sun swings west.
  const westBlock = box(270, 15, 15, 60);
  const from = new Date("2026-06-21T12:00:00Z");

  it("finds the change to the minute between two half-hour samples", () => {
    const surroundings = prepareSunSurroundings(LONDON, [OWN_PUB, westBlock])!;
    const timeline = buildSunTimeline(surroundings, from);
    const first = timeline.segments[0];
    expect(first?.state).toBe("sun");
    const change = first?.end ?? timeline.to;
    expect(change.getTime()).toBeGreaterThan(from.getTime());
    expect(change.getTime()).toBeLessThan(timeline.to.getTime());
    expect(change.getTime() % 60_000).toBe(0);
    expect(sunStateAt(surroundings, new Date(change.getTime() - 60_000))).toBe("sun");
    expect(sunStateAt(surroundings, change)).toBe("shade");
    expect(segmentAt(timeline, change)?.state).toBe("shade");
  });

  it("says when the sun leaves the garden, and when it comes back", () => {
    const estimate = estimateSun({ point: LONDON, hasRecordedOutdoorSpace: true, buildings: [OWN_PUB, westBlock], from });
    expect(estimate.kind).toBe("estimate");
    expect(sunHeadline(estimate, from, true)).toMatch(/^Sun on the garden until \d\d:\d\d$/);
    if (estimate.kind !== "estimate") return;
    const inShade = new Date((estimate.timeline.segments[0]?.end.getTime() ?? 0) + 10 * 60_000);
    expect(sunHeadline(estimate, inShade, false)).toMatch(/^Garden in shade at \d\d:\d\d/);
  });

  it("says until at least the window's end when nothing blocks the sun", () => {
    const morning = new Date("2026-06-21T07:00:00Z");
    const estimate = estimateSun({ point: LONDON, hasRecordedOutdoorSpace: true, buildings: [OWN_PUB], from: morning });
    expect(sunHeadline(estimate, morning, true)).toBe("Sun on the garden until at least 14:00");
  });

  it("fails closed with no recorded garden or no building data", () => {
    const noGarden = estimateSun({ point: LONDON, hasRecordedOutdoorSpace: false, buildings: [OWN_PUB], from });
    expect(sunHeadline(noGarden, from, true)).toBe("No sun estimate: no recorded garden or outdoor seating.");
    for (const buildings of [null, [], [box(90, 400, 20)]]) {
      const noData = estimateSun({ point: LONDON, hasRecordedOutdoorSpace: true, buildings, from });
      expect(noData).toEqual({ kind: "no-estimate", reason: "no-building-data" });
      expect(sunHeadline(noData, from, true)).toBe("No sun estimate: no building heights loaded here.");
    }
  });

  it("adds the cloud half only for now, only for a sunny spot, and only for a known condition", () => {
    expect(sunSkyNote("sun", true, "Cloudy")).toBe("Sunny spot, but cloudy now (Open-Meteo).");
    expect(sunSkyNote("sun", true, "Clear")).toBeNull();
    expect(sunSkyNote("sun", false, "Cloudy")).toBeNull();
    expect(sunSkyNote("shade", true, "Rain")).toBeNull();
    expect(sunSkyNote("sun", true, null)).toBeNull();
    expect(sunSkyNote("sun", true, "Weather code 4")).toBeNull();
  });

  it("names itself an estimate and not a weather report", () => {
    expect(SUN_ESTIMATE_CAVEAT).toBe("Estimate from building heights and sun angle, not a weather report.");
  });
});
