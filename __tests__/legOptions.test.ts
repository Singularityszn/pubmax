import { afterEach, describe, expect, it, vi } from "vitest";

import {
  estimatedRouteSteps,
  formatLegFare,
  legOptionName,
  legOptionsSourceNote,
  legWalkSummary,
  parseTflLineString,
  rankLegOptions,
  type LegOption,
} from "@/lib/legOptions";
import { legOptionsFromTfl, tflLondonDeparture } from "@/lib/tflLegOptions.server";

// The shape TfL's Journey Planner answers in (api.tfl.gov.uk/Journey/
// JourneyResults), cut to what the options read: a journey's minutes, its
// fare in pence, and each leg's mode, line, walking metres and [lat, lng] path string.
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
      fare: { totalCost: 300, fares: [{ chargeLevel: "Off Peak" }] },
      legs: [
        { duration: 9, distance: 581, mode: { id: "walking" }, path: { lineString: path(soho, station) } },
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
  journeys: [{ duration: 29, legs: [{ duration: 29, distance: 2100, mode: { id: "walking" }, path: { lineString: path(soho, marylebone) } }] }],
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

  it("carries TfL's walking metres as the basis of estimated steps, and none when TfL measured none", () => {
    const options = legOptionsFromTfl(transit, walking);
    const byId = Object.fromEntries(options.map((option) => [option.id, option]));
    expect(byId.walk).toMatchObject({ walkMetres: 2100, estimate: false });
    expect(estimatedRouteSteps(byId.walk!.walkMetres)).toBe(2800);
    expect(byId["transit-1"]).toMatchObject({ walkMetres: 581, farePence: 300, fareLevel: "Off Peak" });
    // The bus's walk to the stop has no TfL distance, so no step figure is made up.
    expect(byId["transit-2"]).toMatchObject({ walkMetres: null, farePence: null, fareLevel: null });
    expect(estimatedRouteSteps(byId["transit-2"]!.walkMetres)).toBeNull();
    for (const extraMetres of [150, undefined]) {
      const legs = [...walking.journeys[0]!.legs, {
        duration: 1, mode: { id: "walking" }, path: { lineString: "[]" },
        ...(extraMetres === undefined ? {} : { distance: extraMetres }),
      }];
      const [walk] = legOptionsFromTfl(null, { journeys: [{ duration: 30, legs }] });
      expect(walk?.walkMetres).toBe(extraMetres === undefined ? null : 2250);
    }
  });

  it("measures a straight-line walk estimate by the straight line", () => {
    const ends = { from: { lat: soho[0], lng: soho[1] }, to: { lat: marylebone[0], lng: marylebone[1] } };
    const walk = legOptionsFromTfl(null, null, ends)[0]!;
    expect(walk.walkMetres).toBeGreaterThan(2000);
    expect(walk.walkMetres).toBeLessThan(2200);
    expect(walk.parts[0]!.metres).toBe(walk.walkMetres);
  });

  it("offers one route listed at two departure times once", () => {
    const twice = { journeys: [transit.journeys[1]!, transit.journeys[1]!, transit.journeys[2]!] };
    expect(legOptionsFromTfl(twice, null).map(legOptionName)).toEqual(["Bus 98", "Tube · Bakerloo"]);
  });
});

describe("tflLondonDeparture", () => {
  it("asks in London's wall clock across GMT, BST and midnight", () => {
    expect(tflLondonDeparture(new Date("2026-11-15T21:30:00Z"))).toEqual({
      query: "&date=20261115&time=2130&timeIs=Departing",
      echo: "2026-11-15T21:30:00",
    });
    expect(tflLondonDeparture(new Date("2026-07-10T20:30:00Z")).query).toBe("&date=20260710&time=2130&timeIs=Departing");
    expect(tflLondonDeparture(new Date("2026-07-10T23:30:00Z")).query).toBe("&date=20260711&time=0030&timeIs=Departing");
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
    const ride = (mode: LegOption["parts"][number]["mode"], line: string | null, minutes: number) => ({ mode, line, minutes, metres: null, path: [] });
    const walk = ride("walking", null, 3);
    expect(legOptionName(option([walk, ride("tube", "Central", 4), walk]))).toBe("Tube · Central");
    expect(legOptionName(option([ride("bus", "98", 3), ride("tube", "Bakerloo", 4)]))).toBe("Bus 98 then Tube · Bakerloo");
    expect(legOptionName(option([ride("dlr", null, 6)]))).toBe("DLR");
  });

  it("estimates steps only from a distance, and labels a walk, an estimate and a ride's walking apart", () => {
    expect(estimatedRouteSteps(null)).toBeNull();
    expect(estimatedRouteSteps(0)).toBeNull();
    expect(estimatedRouteSteps(750)).toBe(1000);
    expect(legWalkSummary({ kind: "walk", estimate: false, walkMetres: 1234 })).toBe("1.2 km · about 1,650 steps");
    expect(legWalkSummary({ kind: "walk", estimate: true, walkMetres: 2100 })).toBe("~2.1 km straight line · about 2,800 steps");
    expect(legWalkSummary({ kind: "transit", estimate: false, walkMetres: 448 })).toBe("450 m on foot · about 600 steps");
    expect(legWalkSummary({ kind: "transit", estimate: false, walkMetres: 0 })).toBeNull();
    expect(legWalkSummary({ kind: "transit", estimate: false, walkMetres: null })).toBeNull();
  });

  it("says what TfL answered for, and adds the fare and step bases only when they apply", () => {
    const options = legOptionsFromTfl(transit, walking);
    expect(legOptionsSourceNote({ basis: "now" }, options)).toBe(
      "Times, distances and fares from TfL, if you leave now. A fare is TfL's listed pay as you go fare. Your final charge can differ. Steps are estimated from distance at 75 cm a step, not counted.",
    );
    // A confirmed later departure reads in London time, in GMT and in BST.
    expect(legOptionsSourceNote({ basis: "at", at: "2026-11-15T21:30:00.000Z" }, options)).toMatch(/^Times, distances and fares from TfL, leaving at 21:30\./);
    expect(legOptionsSourceNote({ basis: "at", at: "2026-07-10T20:30:00.000Z" }, options)).toMatch(/leaving at 21:30\./);
    // Without a timetabled answer only the walk is TfL's; an estimate alone is ours.
    const walkOnly = legOptionsFromTfl(null, walking);
    expect(legOptionsSourceNote(null, walkOnly)).toBe("Walking times and distances from TfL. Steps are estimated from distance at 75 cm a step, not counted.");
    const ends = { from: { lat: soho[0], lng: soho[1] }, to: { lat: marylebone[0], lng: marylebone[1] } };
    expect(legOptionsSourceNote(null, legOptionsFromTfl(null, null, ends))).toBe(
      "A straight-line time is our own estimate. Steps are estimated from distance at 75 cm a step, not counted.",
    );
    // An unpriced ride adds no fare basis, because there is no fare to qualify.
    expect(legOptionsSourceNote({ basis: "now" }, legOptionsFromTfl({ journeys: [transit.journeys[2]!] }, null))).toBe(
      "Times, distances and fares from TfL, if you leave now.",
    );
  });

  it("ranks ties in TfL's order and keeps both marks on one option", () => {
    const base = { kind: "transit" as const, parts: [], estimate: false, fareLevel: null, walkMetres: null };
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
    expect(body.departure).toEqual({ basis: "now" });
    expect(asked).toHaveLength(2);
    for (const href of asked) {
      expect(new URL(href).hostname).toBe("api.tfl.gov.uk");
      expect(href).toContain("/Journey/JourneyResults/51.51450,-0.13180/to/51.52350,-0.15800");
      expect(new URL(href).searchParams.has("time")).toBe(false);
    }
  });

  it("is unavailable, without asking TfL, outside London, and when TfL answers neither question", async () => {
    const fetchSpy = vi.fn(async () => new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { GET } = await import("@/app/api/leg-options/route");
    const outside = await (await GET(url("from=53.48,-2.24&to=53.47,-2.25"))).json();
    expect(outside).toEqual({ status: "unavailable", options: [], departure: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    const down = await (await GET(url("from=51.5145,-0.1318&to=51.5235,-0.158"))).json();
    expect(down).toEqual({ status: "unavailable", options: [], departure: null });
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

  describe("a later departure", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const stubTfl = (echo: string | null) => {
      const asked: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
        const href = String(input);
        asked.push(href);
        if (href.includes("mode=walking&")) return Response.json(walking);
        return Response.json({ ...transit, searchCriteria: echo ? { dateTime: echo, dateTimeType: "Departing" } : undefined });
      }));
      return asked;
    };

    it("asks TfL for the rides at London's wall-clock time, and says so only when TfL echoes it", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-07-10T18:00:00Z"));
      const asked = stubTfl("2026-07-10T21:30:00");
      const { GET } = await import("@/app/api/leg-options/route");
      const body = await (await GET(url("from=51.5145,-0.1318&to=51.5235,-0.158&depart=2026-07-10T20:30:00.000Z"))).json();
      const rides = new URL(asked.find((href) => !href.includes("mode=walking&"))!).searchParams;
      expect([rides.get("date"), rides.get("time"), rides.get("timeIs")]).toEqual(["20260710", "2130", "Departing"]);
      // No timetable moves a walk, so the walking question is not dated.
      expect(new URL(asked.find((href) => href.includes("mode=walking&"))!).searchParams.has("time")).toBe(false);
      expect(body.departure).toEqual({ basis: "at", at: "2026-07-10T20:30:00.000Z" });
      expect(body.options.some((option: { kind: string }) => option.kind === "transit")).toBe(true);
    });

    it("drops the rides, keeping the walk, when TfL answers for a time it was not asked", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-15T19:00:00Z"));
      stubTfl("2026-11-15T19:00:00");
      const { GET } = await import("@/app/api/leg-options/route");
      const body = await (await GET(url("from=51.5145,-0.1318&to=51.5235,-0.158&depart=2026-11-15T21:30:00Z"))).json();
      expect(body.departure).toBeNull();
      expect(body.options.map((option: { id: string }) => option.id)).toEqual(["walk"]);
    });

    it("treats a departure already past as now, and refuses one unreadable or over a day ahead", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-15T19:00:00Z"));
      const asked = stubTfl(null);
      const { GET } = await import("@/app/api/leg-options/route");
      const past = await (await GET(url("from=51.5145,-0.1318&to=51.5235,-0.158&depart=2026-11-15T18:00:00Z"))).json();
      expect(past.departure).toEqual({ basis: "now" });
      expect(asked.every((href) => !new URL(href).searchParams.has("time"))).toBe(true);
      for (const depart of ["tonight", "2026-11-16T20:00:00Z"]) {
        const response = await GET(url(`from=51.5145,-0.1318&to=51.5235,-0.158&depart=${depart}`));
        expect(response.status).toBe(400);
      }
    });
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
