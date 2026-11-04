import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatLegFare,
  legOptionName,
  parseTflLineString,
  rankLegOptions,
  type LegOption,
} from "@/lib/legOptions";
import { legOptionsFromTfl } from "@/lib/tflLegOptions.server";

// The shape TfL's Journey Planner answers in (api.tfl.gov.uk/Journey/
// JourneyResults), cut to what the options read: a journey's minutes, its
// fare in pence, and each leg's mode, line and [lat, lng] path string.
const path = (from: [number, number], to: [number, number]) => `[[${from[0]}, ${from[1]}],[${to[0]}, ${to[1]}]]`;
const soho: [number, number] = [51.5145, -0.1318];
const station: [number, number] = [51.5163, -0.1304];
const marylebone: [number, number] = [51.5235, -0.158];

const transit = {
  journeys: [
    {
      duration: 31,
      fare: { totalCost: 600 },
      legs: [
        { duration: 8, mode: { id: "walking" }, path: { lineString: path(soho, station) } },
        { duration: 12, mode: { id: "elizabeth-line" }, routeOptions: [{ name: "Elizabeth line" }], path: { lineString: path(station, marylebone) } },
      ],
    },
    {
      duration: 26,
      fare: { totalCost: 300 },
      legs: [
        { duration: 9, mode: { id: "walking" }, path: { lineString: path(soho, station) } },
        { duration: 4, mode: { id: "tube" }, routeOptions: [{ name: "Bakerloo" }], path: { lineString: path(station, marylebone) } },
      ],
    },
    {
      duration: 24,
      legs: [
        { duration: 5, mode: { id: "walking" }, path: { lineString: path(soho, station) } },
        { duration: 3, mode: { id: "bus" }, routeOptions: [{ name: "98" }], path: { lineString: path(station, marylebone) } },
      ],
    },
    // A walk-only answer in the transit question: the walk is never listed twice.
    { duration: 30, legs: [{ duration: 30, mode: { id: "walking" }, path: { lineString: path(soho, marylebone) } }] },
  ],
};
const walking = {
  journeys: [{ duration: 29, legs: [{ duration: 29, mode: { id: "walking" }, path: { lineString: path(soho, marylebone) } }] }],
};

describe("parseTflLineString", () => {
  it("turns TfL's [lat, lng] string into [lng, lat] points for the map", () => {
    expect(parseTflLineString("[[51.5145, -0.1318],[51.5163, -0.1304]]")).toEqual([[-0.1318, 51.5145], [-0.1304, 51.5163]]);
  });

  it("is no path for anything that is not two finite points", () => {
    expect(parseTflLineString("[[51.5, -0.1]]")).toEqual([]);
    expect(parseTflLineString("not json")).toEqual([]);
    expect(parseTflLineString(undefined)).toEqual([]);
    expect(parseTflLineString('[["a", 1],[51.5, -0.1]]')).toEqual([]);
  });
});

describe("the options for one leg", () => {
  it("offers TfL's walk and its rides, fastest first, with the fastest and the cheapest marked", () => {
    const options = legOptionsFromTfl(transit, walking);
    expect(options.map((option) => [option.id, option.minutes, option.farePence, option.fastest, option.cheapest])).toEqual([
      ["transit-2", 24, null, true, false],
      ["transit-1", 26, 300, false, false],
      ["walk", 29, 0, false, true],
      ["transit-0", 31, 600, false, false],
    ]);
    expect(options.map(legOptionName)).toEqual(["Bus 98", "Tube · Bakerloo", "Walk", "Elizabeth line"]);
  });

  it("keeps each part's own path from TfL, never a straight line between the stops", () => {
    const [bus] = legOptionsFromTfl(transit, walking);
    expect(bus!.parts.map((part) => [part.mode, part.line, part.minutes])).toEqual([["walking", null, 5], ["bus", "98", 3]]);
    expect(bus!.parts[1]!.path).toEqual([[-0.1304, 51.5163], [-0.158, 51.5235]]);
  });

  it("never makes an option with no listed fare the cheapest", () => {
    const options = legOptionsFromTfl({ journeys: [transit.journeys[2]!] }, null);
    expect(options).toHaveLength(1);
    expect(options[0]!.cheapest).toBe(false);
    expect(options[0]!.fastest).toBe(true);
  });

  it("keeps at most three rides, and drops journeys with no time or no path", () => {
    const many = { journeys: [...transit.journeys.slice(0, 3), transit.journeys[1]!, transit.journeys[0]!] };
    expect(legOptionsFromTfl(many, null).filter((option) => option.kind === "transit")).toHaveLength(3);
    const broken = {
      journeys: [
        { legs: transit.journeys[0]!.legs },
        { duration: 10, legs: [{ duration: 10, mode: { id: "tube" }, path: { lineString: "[]" } }] },
      ],
    };
    expect(legOptionsFromTfl(broken, null)).toEqual([]);
  });

  it("offers only the walk when TfL's transit question failed, and nothing when both did", () => {
    expect(legOptionsFromTfl(null, walking).map((option) => option.id)).toEqual(["walk"]);
    expect(legOptionsFromTfl(null, null)).toEqual([]);
  });

  it("estimates a walk TfL will not plan as a straight line, free but never the fastest", () => {
    const ends = { from: { lat: soho[0], lng: soho[1] }, to: { lat: marylebone[0], lng: marylebone[1] } };
    const options = legOptionsFromTfl({ journeys: [transit.journeys[1]!] }, null, ends);
    const walk = options.find((option) => option.kind === "walk")!;
    expect(walk.estimate).toBe(true);
    expect(walk.farePence).toBe(0);
    expect(walk.cheapest).toBe(true);
    // About 2.1 km in a straight line at 4.8 km/h is 26 minutes, as fast as the
    // tube on paper, but a straight line is shorter than any real walk.
    expect(walk.minutes).toBe(26);
    expect(walk.fastest).toBe(false);
    expect(walk.parts[0]!.path).toEqual([[soho[1], soho[0]], [marylebone[1], marylebone[0]]]);
    expect(options.find((option) => option.kind === "transit")!.fastest).toBe(true);
    // With nothing timed on offer, the estimate is all there is.
    expect(legOptionsFromTfl(null, null, ends)[0]).toMatchObject({ id: "walk", estimate: true, fastest: true, cheapest: true });
  });

  it("offers one route listed at two departure times once", () => {
    const twice = { journeys: [transit.journeys[1]!, transit.journeys[1]!, transit.journeys[2]!] };
    expect(legOptionsFromTfl(twice, null).map(legOptionName)).toEqual(["Bus 98", "Tube · Bakerloo"]);
  });
});

describe("the words", () => {
  it("prices a walk as free, a ride in pounds, and never guesses a missing fare", () => {
    expect(formatLegFare(0)).toBe("Free");
    expect(formatLegFare(280)).toBe("£2.80");
    expect(formatLegFare(null)).toBe("Fare not listed");
  });

  it("names a ride by its mode and line, and a change with 'then'", () => {
    const option = (parts: LegOption["parts"]): Pick<LegOption, "kind" | "parts"> => ({ kind: "transit", parts });
    const walk = { mode: "walking" as const, line: null, minutes: 3, path: [] };
    expect(legOptionName(option([walk, { mode: "tube", line: "Central", minutes: 4, path: [] }, walk]))).toBe("Tube · Central");
    expect(legOptionName(option([{ mode: "bus", line: "98", minutes: 3, path: [] }, { mode: "tube", line: "Bakerloo", minutes: 4, path: [] }])))
      .toBe("Bus 98 then Tube · Bakerloo");
    expect(legOptionName(option([{ mode: "dlr", line: null, minutes: 6, path: [] }]))).toBe("DLR");
  });

  it("ranks ties in TfL's order and keeps both marks on one option", () => {
    const base = { kind: "transit" as const, parts: [], estimate: false };
    const ranked = rankLegOptions([
      { ...base, id: "a", minutes: 10, farePence: 175 },
      { ...base, id: "b", minutes: 10, farePence: 175 },
    ]);
    expect(ranked.map((option) => [option.id, option.fastest, option.cheapest])).toEqual([["a", true, true], ["b", false, false]]);
  });
});

describe("GET /api/leg-options", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const url = (query: string) => new Request(`http://localhost/api/leg-options?${query}`, { headers: { "x-forwarded-for": "198.51.100.77" } });

  it("asks TfL the transit and the walking questions for two London stops, and never shares the answer", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      asked.push(href);
      return Response.json(href.includes("mode=walking&") ? walking : transit);
    }));
    const { GET } = await import("@/app/api/leg-options/route");
    const response = await GET(url("from=51.5145,-0.1318&to=51.5235,-0.158"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.options).toHaveLength(4);
    expect(body.options.every((option: { estimate: boolean }) => option.estimate === false)).toBe(true);
    expect(asked).toHaveLength(2);
    for (const href of asked) {
      expect(new URL(href).hostname).toBe("api.tfl.gov.uk");
      expect(href).toContain("/Journey/JourneyResults/51.51450,-0.13180/to/51.52350,-0.15800");
    }
  });

  it("is unavailable, without asking TfL, outside London, and when TfL answers neither question", async () => {
    const fetchSpy = vi.fn(async () => new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { GET } = await import("@/app/api/leg-options/route");
    const outside = await (await GET(url("from=53.48,-2.24&to=53.47,-2.25"))).json();
    expect(outside).toEqual({ status: "unavailable", options: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
    const down = await (await GET(url("from=51.5145,-0.1318&to=51.5235,-0.158"))).json();
    expect(down).toEqual({ status: "unavailable", options: [] });
  });

  it("answers a long walk TfL cannot plan with the straight-line estimate beside its rides", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("mode=walking&")) return Response.json({ message: "No journey found for your inputs." }, { status: 404 });
      return Response.json({ journeys: [transit.journeys[1]] });
    }));
    const { GET } = await import("@/app/api/leg-options/route");
    const body = await (await GET(url("from=51.5145,-0.1318&to=51.5235,-0.158"))).json();
    expect(body.status).toBe("ok");
    expect(body.options.map((option: { id: string; estimate: boolean }) => [option.id, option.estimate])).toEqual([["walk", true], ["transit-0", false]]);
  });

  it("refuses points that are not lat,lng", async () => {
    const { GET } = await import("@/app/api/leg-options/route");
    for (const query of ["from=51.5&to=51.5,-0.1", "from=a,b&to=51.5,-0.1", "from=51.5,-0.1,9&to=51.5,-0.1", "to=51.5,-0.1"]) {
      const response = await GET(url(query));
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("INVALID_REQUEST");
    }
  });
});
