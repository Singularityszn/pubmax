import { describe, expect, it } from "vitest";
import { sunPosition } from "@/lib/weatherDaylight";
import {
  buildSunTimeline,
  estimateSun,
  formatSunClock,
  indexSunBuildings,
  occupiedStretches,
  OPENMAPTILES_DEFAULT_HEIGHT_M,
  shadowDiscLoaded,
  SKY_READING_MAX_AGE_MS,
  sunBuildingFromTile,
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
    expect(sunHeadline(estimate, from, true)).toMatch(/^Garden likely in sun until \d\d:\d\d$/);
    if (estimate.kind !== "estimate") return;
    const inShade = new Date((estimate.timeline.segments[0]?.end.getTime() ?? 0) + 10 * 60_000);
    expect(sunHeadline(estimate, inShade, false)).toMatch(/^Garden likely in shade at \d\d:\d\d\. Sun likely from|^Garden likely in shade at \d\d:\d\d, and no sun likely before/);
  });

  it("says until at least the window's end when nothing blocks the sun", () => {
    const morning = new Date("2026-06-21T07:00:00Z");
    const estimate = estimateSun({ point: LONDON, hasRecordedOutdoorSpace: true, buildings: [OWN_PUB], from: morning });
    expect(sunHeadline(estimate, morning, true)).toBe("Garden likely in sun until at least 14:00");
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
    const readAt = Date.parse("2026-06-20T12:45:00Z");
    const now = readAt + 20 * 60_000;
    const read = (condition: string) => ({ condition, observedAtMs: readAt });
    expect(sunSkyNote("sun", true, read("Cloudy"), now)).toBe("Sunny spot, but some cloud at 13:45 (Open-Meteo reading).");
    expect(sunSkyNote("sun", true, read("Clear"), now)).toBeNull();
    expect(sunSkyNote("sun", false, read("Cloudy"), now)).toBeNull();
    expect(sunSkyNote("shade", true, read("Rain"), now)).toBeNull();
    expect(sunSkyNote("sun", true, null, now)).toBeNull();
    expect(sunSkyNote("sun", true, read("Weather code 4"), now)).toBeNull();
  });

  it("drops the cloud half once the reading is older than its limit, even with the map standing still", () => {
    const readAt = Date.parse("2026-06-20T06:00:00Z");
    const sky = { condition: "Rain", observedAtMs: readAt };
    expect(sunSkyNote("sun", true, sky, readAt + SKY_READING_MAX_AGE_MS)).toBe("Sunny spot, but rain at 07:00 (Open-Meteo reading).");
    expect(sunSkyNote("sun", true, sky, readAt + SKY_READING_MAX_AGE_MS + 60_000)).toBeNull();
    expect(sunSkyNote("sun", true, { condition: "Rain", observedAtMs: Number.NaN }, readAt)).toBeNull();
  });

  it("names itself an estimate and not a weather report", () => {
    expect(SUN_ESTIMATE_CAVEAT).toBe("Estimate from building heights and sun angle, not a weather report.");
  });
});

describe("review fixes: what the basemap really serves", () => {
  // The basemap's building features carry render_height, render_min_height,
  // colour and hide_3d, and nothing else (OpenFreeMap planet tiles, Oct 2026).
  const rings = box(180, 10, 0).rings;

  it("reads the OpenMapTiles fill-in height as unknown, and a real height as itself", () => {
    expect(OPENMAPTILES_DEFAULT_HEIGHT_M).toBe(5);
    expect(sunBuildingFromTile({ render_height: 5, render_min_height: 0, colour: "#e0d7cb" }, rings)?.heightM).toBeNull();
    expect(sunBuildingFromTile({ render_min_height: 0 }, rings)?.heightM).toBeNull();
    expect(sunBuildingFromTile({ render_height: 26, render_min_height: 0 }, rings)?.heightM).toBe(26);
    expect(sunBuildingFromTile({ render_height: 40, render_min_height: 12 }, rings)?.baseM).toBe(12);
  });

  it("leaves out an outline the basemap hides in 3D, because its parts answer for it", () => {
    expect(sunBuildingFromTile({ render_height: 30, hide_3d: true }, rings)).toBeNull();
  });

  it("never reports sun beside a block whose tile height is the fill-in default", () => {
    const tileBlock = sunBuildingFromTile({ render_height: 5, render_min_height: 0 }, box(180, 10, 0).rings);
    expect(tileBlock).not.toBeNull();
    expect(stateWith([tileBlock!], DECEMBER_NOON)).toBe("unknown");
  });

  it("lets a low sun pass under a raised part, and not through a part on the ground", () => {
    expect(stateWith([{ ...box(180, 10, 40), baseM: 20 }], DECEMBER_NOON)).toBe("sun");
    expect(stateWith([{ ...box(180, 10, 40), baseM: 0 }], DECEMBER_NOON)).toBe("shade");
  });

  it("skips every piece of the pub's own building when a tile edge cut it in two", () => {
    // The pub stands in the north piece; the south piece shares the id and would
    // otherwise put a 12 m wall right beside the pub.
    const north = { ...box(0, -4, 12, 12, 8), id: 777 };
    const south = { ...box(180, 4, 12, 12, 8), id: 777 };
    expect(stateWith([north, south], DECEMBER_NOON)).toBe("sun");
    expect(stateWith([north, { ...south, id: 778 }], DECEMBER_NOON)).toBe("shade");
  });

  it("gives no estimate for a pub whose shadow disc runs past the loaded area", () => {
    const area = { west: LONDON[0] - 0.01, south: LONDON[1] - 0.01, east: LONDON[0] + 0.01, north: LONDON[1] + 0.01 };
    expect(shadowDiscLoaded(LONDON, area)).toBe(true);
    const edge = { ...area, east: LONDON[0] + 0.002 };
    expect(shadowDiscLoaded(LONDON, edge)).toBe(false);
    const estimate = estimateSun({ point: LONDON, hasRecordedOutdoorSpace: true, buildings: [OWN_PUB], from: JUNE_NOON, loadedArea: edge });
    expect(estimate).toEqual({ kind: "no-estimate", reason: "edge-of-view" });
    expect(sunHeadline(estimate, JUNE_NOON, true)).toBe("No sun estimate: move the map so this pub is not at its edge.");
  });

  it("hands each pub only the buildings a shadow could reach", () => {
    const near = box(180, 50, 20);
    const far = box(90, 2_000, 20);
    const index = indexSunBuildings([OWN_PUB, near, far]);
    const found = index.near(LONDON);
    expect(found).toContain(near);
    expect(found).toContain(OWN_PUB);
    expect(found).not.toContain(far);
  });

  it("rounds the end of sun down and the start of sun up, in BST and in GMT", () => {
    const summer = new Date("2026-06-20T14:03:00Z");
    expect(formatSunClock(summer)).toBe("15:00");
    expect(formatSunClock(summer, "up")).toBe("15:05");
    expect(formatSunClock(summer, "exact")).toBe("15:03");
    const winter = new Date("2026-12-21T15:03:00Z");
    expect(formatSunClock(winter)).toBe("15:00");
    expect(formatSunClock(winter, "up")).toBe("15:05");
    expect(formatSunClock(new Date("2026-12-21T15:05:00Z"), "up")).toBe("15:05");
  });
});

describe("second review: no sun claim through what is not known", () => {
  it("answers unknown for a building of no recorded height anywhere in the shadow reach", () => {
    // June noon: a 30 m stand-in would reach only 15 m, but a real tower 50 m
    // south could be 60 m tall, so no sun may be claimed.
    expect(stateWith([box(180, 50, null)], JUNE_NOON)).toBe("unknown");
  });

  it("sees a raised part that the ray passes under at its near wall and enters before its far wall", () => {
    // Footprint 10 to 20 m south, underside 5 m, roof 40 m, sun about 15 degrees:
    // the ray is at 3.9 m at the near wall and 6.6 m at the far wall.
    expect(stateWith([{ ...box(180, 10, 40, 40, 10), baseM: 5 }], DECEMBER_NOON)).toBe("shade");
  });
});

describe("third review: a corner touch is not a way in", () => {
  /** A ring given in local metres as (across, along), where along points at the bearing. */
  function ringFromLocal(points: Array<[number, number]>, bearingDeg: number): LngLat[] {
    const cosLat = Math.cos((LONDON[1] * Math.PI) / 180);
    const b = (bearingDeg * Math.PI) / 180;
    return points.map(([across, along]) => {
      const x = Math.sin(b) * along + Math.cos(b) * across;
      const y = Math.cos(b) * along - Math.sin(b) * across;
      return [LONDON[0] + x / (111_320 * cosLat), LONDON[1] + y / 110_540];
    });
  }

  it("finds the raised part the ray really enters after touching a corner", () => {
    // The ray towards the December noon sun touches the corner at 10 m, then
    // enters at 20 m and leaves at 30 m, where it climbs through the underside.
    const sunBearing = sunPosition(LONDON[1], LONDON[0], DECEMBER_NOON)!.azimuthDeg;
    const ring = ringFromLocal([[0, 10], [5, 5], [10, 5], [10, 30], [-5, 30], [-5, 20], [5, 20], [5, 15]], sunBearing);
    expect(stateWith([{ rings: [ring], heightM: 7.5, baseM: 6.8 }], DECEMBER_NOON)).toBe("shade");
  });

  it("still sees a courtyard as open sky inside its building", () => {
    // The pub stands in a courtyard 20 m across; walls 12 m tall all round.
    const sunBearing = sunPosition(LONDON[1], LONDON[0], JUNE_NOON)!.azimuthDeg;
    const outer = ringFromLocal([[-40, -40], [40, -40], [40, 40], [-40, 40]], sunBearing);
    const yard = ringFromLocal([[-10, -10], [10, -10], [10, 10], [-10, 10]], sunBearing);
    // June noon: the 12 m wall 10 m away casts about 5.8 m, so the middle is in sun.
    expect(stateWith([{ rings: [outer, yard], heightM: 12 }], JUNE_NOON)).toBe("sun");
    // December noon: the same wall casts about 40 m, so the yard is in shade.
    expect(stateWith([{ rings: [outer, yard], heightM: 12 }], DECEMBER_NOON)).toBe("shade");
  });
});

describe("third review: inside stretches on exact coordinates", () => {
  const along = { x: 0, y: 1 };
  const pts = (list: Array<[number, number]>) => list.map(([x, y]) => ({ x, y }));

  it("does not take a corner touch at 10 m as a way in", () => {
    const ring = pts([[0, 10], [5, 5], [10, 5], [10, 30], [-5, 30], [-5, 20], [5, 20], [5, 15]]);
    expect(occupiedStretches([ring], along, 300)).toEqual([[20, 30]]);
  });

  it("keeps a courtyard open and the walls round it closed", () => {
    const outer = pts([[-40, -40], [40, -40], [40, 40], [-40, 40]]);
    const yard = pts([[-10, -10], [10, -10], [10, 10], [-10, 10]]);
    expect(occupiedStretches([outer, yard], along, 300)).toEqual([[10, 40]]);
  });
});
