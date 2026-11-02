// Pal hops (wild idea 08), the pure half: which painted pins the robin
// visits, in what order, how a hop moves, where the robin stands and what it
// says. The component (components/wild/PalHop.tsx) only feeds these the map's
// own answers, so the honesty of the route lives here.

import { describe, expect, it } from "vitest";

import {
  PAL_HOP_MAX_HOPS,
  PAL_HOP_ROBIN_PX,
  nearestPricedArea,
  palHopAnchor,
  palHopAnswer,
  palHopBubblePlacement,
  palHopDrinkLine,
  palHopEmptyLine,
  palHopFootprints,
  palHopPerch,
  palHopPose,
  palHopRoute,
  palHopTotalMs,
  palHopViewBounds,
  slimRowPintPrice,
  stopsInView,
  type PalHopPoint,
  type PalHopStop,
} from "@/components/wild/palHopPlan";
import type { SlimVenue } from "@/lib/venuesSlim";

function row(id: string, cheapestPrice: number | null, extra: Partial<SlimVenue> = {}): SlimVenue {
  return { id, name: `Pub ${id}`, lat: 51.51, lng: -0.13, cheapestPrice, borough: "Westminster", ...extra };
}

function mark(id: string, x: number, y: number, kind: PalHopPoint["kind"] = "pin"): PalHopPoint {
  return { kind, id, x, y, lng: -0.13 + x / 1e5, lat: 51.51 - y / 1e5 };
}

function stop(id: string, priceGbp: number, x = 100, y = 300): PalHopStop {
  return { id, name: `Pub ${id}`, x, y, lng: -0.13 + x / 1e5, lat: 51.51 - y / 1e5, priceGbp, priceSource: "Pint Prices", priceObservedAt: "2026-10-02" };
}

/** Every stop painted as its own pin. */
function pinsFor(stops: readonly PalHopStop[]): PalHopPoint[] {
  return stops.map((s) => mark(s.id, s.x, s.y));
}

describe("which pubs in view carry a pint price", () => {
  it("reads a pub's figure and refuses non-pint figures", () => {
    expect(slimRowPintPrice(row("a", 4.2))).toBe(4.2);
    expect(slimRowPintPrice(row("b", 4.2, { kind: "pub" }))).toBe(4.2);
    expect(slimRowPintPrice(row("c", 4.2, { kind: "bar", legacyOsmBar: true }))).toBe(4.2);
    expect(slimRowPintPrice(row("d", 4.2, { kind: "bar" }))).toBeNull();
    expect(slimRowPintPrice(row("e", 9, { kind: "restaurant" }))).toBeNull();
    expect(slimRowPintPrice(row("f", 12, { anchorLabel: "Set lunch" }))).toBeNull();
    expect(slimRowPintPrice(row("g", null))).toBeNull();
    expect(slimRowPintPrice(row("h", 0))).toBeNull();
  });

  it("keeps the priced rows drawn inside the map's region, once each, where the camera draws them", () => {
    const rows = [
      row("in", 5.1, { lng: 1, lat: 1, priceSource: " Pint Prices ", priceObservedAt: "2026-10-02" }),
      row("in", 5.1, { lng: 1, lat: 1 }),
      row("unpriced", null, { lng: 2, lat: 2 }),
      row("off", 3.9, { lng: 9, lat: 9 }),
      row("under-bar", 3.5, { lng: 3, lat: 3 }),
    ];
    const drawn: Record<string, { x: number; y: number }> = { "1": { x: 100, y: 300 }, "2": { x: 120, y: 320 }, "9": { x: 900, y: 300 }, "3": { x: 100, y: 20 } };
    const stops = stopsInView(rows, ([lng]) => drawn[String(lng)] ?? null, { left: 0, top: 80, right: 390, bottom: 800 });
    expect(stops.map((s) => s.id)).toEqual(["in"]);
    expect(stops[0]).toMatchObject({ priceGbp: 5.1, priceSource: "Pint Prices", priceObservedAt: "2026-10-02", x: 100, y: 300 });
  });

  it("perches on the pub's own pin, or on the cluster disc it is gathered into", () => {
    const pub = stop("p", 4, 200, 400);
    expect(palHopAnchor(pub, [mark("p", 201, 399)])).toMatchObject({ x: 201, y: 399, reach: 15 });
    const gathered = palHopAnchor(pub, [mark("c1", 230, 420, "cluster"), mark("c2", 600, 400, "cluster")]);
    expect(gathered).toMatchObject({ x: 230, y: 420 });
    expect(gathered.reach).toBeGreaterThan(15);
    expect(palHopAnchor(pub, [mark("far", 400, 700, "cluster")])).toMatchObject({ x: 200, y: 400 });
  });
});

describe("the route", () => {
  it("ends on the cheapest, and every hop before it lands on a dearer pint than the last", () => {
    const stops = [stop("a", 6.1, 50, 200), stop("b", 5.2, 300, 500), stop("c", 6.4, 200, 400), stop("d", 5.9, 80, 650), stop("e", 6.05, 330, 260), stop("f", 7, 150, 150)];
    const route = palHopRoute(stops, pinsFor(stops))!;
    expect(route.winner.stop.id).toBe("b");
    expect(route.legs[route.legs.length - 1]).toBe(route.winner);
    expect(route.legs.length).toBeLessThanOrEqual(PAL_HOP_MAX_HOPS);
    expect(route.legs.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < route.legs.length; i += 1) {
      expect(route.legs[i]!.stop.priceGbp).toBeLessThan(route.legs[i - 1]!.stop.priceGbp);
    }
  });

  it("takes the winner the map's own card named, so the robin and the card agree", () => {
    const stops = [stop("a", 4.5, 50, 200), stop("b", 4.5, 300, 600), stop("c", 6, 200, 400)];
    const route = palHopRoute(stops, pinsFor(stops), { winnerId: "b" })!;
    expect(route.winner.stop.id).toBe("b");
    // A pub at the winner's own price is never a stop.
    expect(route.legs.map((leg) => leg.stop.id)).toEqual(["c", "b"]);
  });

  it("breaks a tie on the name, hops straight to a lone priced pub, and has no route without one", () => {
    const tie = [stop("b", 4.5), stop("a", 4.5, 300, 600)];
    expect(palHopRoute(tie, pinsFor(tie))!.winner.stop.id).toBe("a");
    expect(palHopRoute([stop("solo", 5)], [])!.legs.map((leg) => leg.stop.id)).toEqual(["solo"]);
    expect(palHopRoute([], [])).toBeNull();
  });

  it("never lands twice on one mark", () => {
    const stops = [stop("w", 3, 100, 600), stop("x", 6, 200, 300), stop("y", 5.5, 205, 305), stop("z", 5, 210, 310)];
    const route = palHopRoute(stops, [mark("cl", 205, 305, "cluster"), mark("w", 100, 600)])!;
    const anchors = route.legs.map((leg) => `${leg.anchor.x},${leg.anchor.y}`);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(route.winner.stop.id).toBe("w");
  });
});

describe("one hop", () => {
  it("squashes on take-off, stretches in the air, squashes on landing, then rests", () => {
    const flight = 500;
    const crouch = palHopPose(100, flight);
    expect(crouch.lift).toBe(0);
    expect(crouch.scaleX).toBeGreaterThan(1);
    expect(crouch.scaleY).toBeLessThan(1);
    const air = palHopPose(110 + flight / 4, flight);
    expect(air.lift).toBeGreaterThan(0.5);
    expect(air.scaleY).toBeGreaterThan(1);
    const top = palHopPose(110 + flight / 2, flight);
    expect(top.lift).toBeCloseTo(1, 5);
    const land = palHopPose(110 + flight + 10, flight);
    expect(land.along).toBe(1);
    expect(land.scaleY).toBeLessThan(1);
    const done = palHopPose(palHopTotalMs(flight), flight);
    expect(done).toMatchObject({ along: 1, lift: 0, scaleX: 1, scaleY: 1, done: true });
  });

  it("leaves alternating footprints along the ground, and none on a tiny hop", () => {
    const prints = palHopFootprints({ x: 0, y: 0 }, { x: 200, y: 0 });
    expect(prints).toHaveLength(4);
    expect(prints.map((p) => p.side)).toEqual([-1, 1, -1, 1]);
    expect(prints.every((p) => p.x > 0 && p.x < 200 && p.angle === 0)).toBe(true);
    expect(palHopFootprints({ x: 0, y: 0 }, { x: 20, y: 10 })).toEqual([]);
  });
});

describe("where the robin stands", () => {
  const screen = { width: 390, height: 844 };

  it("perches on top of the price pill, never over the figure", () => {
    const feet = palHopPerch({ x: 200, y: 400 }, screen);
    expect(feet.below).toBe(false);
    // Its feet are above the pill's top edge, so its body clears the figure.
    expect(feet.y).toBeLessThanOrEqual(400 - 14);
  });

  it("stands under the pill near the top bar, and inside the screen at the edges", () => {
    const high = palHopPerch({ x: 200, y: 90 }, screen);
    expect(high.below).toBe(true);
    expect(high.y - PAL_HOP_ROBIN_PX).toBeGreaterThanOrEqual(90 + 14);
    const edge = palHopPerch({ x: 2, y: 500 }, screen);
    expect(edge.x - PAL_HOP_ROBIN_PX / 2).toBeGreaterThanOrEqual(0);
  });

  it("keeps the bubble on screen, above the robin when it fits and below when not", () => {
    const bubble = { width: 300, height: 180 };
    const above = palHopBubblePlacement({ x: 370, y: 600 }, bubble, screen);
    expect(above.above).toBe(true);
    expect(above.left + bubble.width).toBeLessThanOrEqual(screen.width - 12);
    expect(above.tailX).toBeGreaterThan(0);
    expect(above.tailX).toBeLessThan(bubble.width);
    const below = palHopBubblePlacement({ x: 30, y: 180 }, bubble, screen);
    expect(below.above).toBe(false);
    expect(below.left).toBeGreaterThanOrEqual(12);
    expect(below.top + bubble.height).toBeLessThanOrEqual(screen.height);
  });
});

describe("what the robin says", () => {
  it("names the price's publisher and read day, and the beer only when the record names it", () => {
    const answer = palHopAnswer(stop("w", 4.2), "Camden Hells");
    expect(answer).toMatchObject({ kicker: "Cheapest pint on screen", drink: "A pint of Camden Hells", pub: "Pub w" });
    expect(answer.provenance).toMatch(/^On record · Pint Prices · read 2 Oct/);
    expect(palHopDrinkLine(null)).toBe("A pint");
    expect(palHopDrinkLine("  ")).toBe("A pint");
    const unsourced = palHopAnswer({ ...stop("u", 4), priceSource: null, priceObservedAt: null }, null);
    expect(unsourced.provenance).toBe("On record · Publisher not recorded");
  });

  it("says plainly why it found nothing, in the house voice", () => {
    for (const reason of ["unpriced", "lens", "unread"] as const) {
      const line = palHopEmptyLine(reason);
      expect(line.length).toBeGreaterThan(10);
      expect(line).not.toMatch(/[!—]/);
    }
  });

  it("offers the nearest area with prices behind it, never one missing price coverage", () => {
    const areas = [
      { slug: "near-unpriced", name: "Near", centre: { lng: -0.131, lat: 51.511 }, coverageStatus: "reviewed" as const, missingEvidence: ["price_coverage" as const] },
      { slug: "paused", name: "Paused", centre: { lng: -0.132, lat: 51.512 }, coverageStatus: "paused" as const, missingEvidence: [] },
      { slug: "far", name: "Far", centre: { lng: -0.2, lat: 51.55 }, coverageStatus: "route_ready" as const, missingEvidence: [] },
      { slug: "mid", name: "Mid", centre: { lng: -0.15, lat: 51.52 }, coverageStatus: "captured" as const, missingEvidence: ["opening_hours" as const] },
    ];
    expect(nearestPricedArea(areas, { lng: -0.13, lat: 51.51 })).toEqual({ slug: "mid", name: "Mid" });
    expect(nearestPricedArea([], { lng: 0, lat: 0 })).toBeNull();
  });

  it("calls a figure people logged since the listing people-logged, and claims no publisher for it", () => {
    expect(palHopAnswer({ ...stop("c", 3.8), peopleLogged: true }, null).provenance).toBe("People-logged price");
  });

  it("reads the slim pack around what the camera shows, wider for a tilted camera", () => {
    const screen = { width: 390, height: 844 };
    const flat = palHopViewBounds({ center: [-0.13, 51.51], zoom: 15, pitch: 0 }, screen);
    expect(flat.west).toBeLessThan(-0.13);
    expect(flat.east).toBeGreaterThan(-0.13);
    expect(flat.south).toBeLessThan(51.51);
    expect(flat.north).toBeGreaterThan(51.51);
    // 422px of screen at zoom 15 is about 0.009 degrees; the box covers it.
    expect(flat.east - flat.west).toBeGreaterThan(0.009);
    const tilted = palHopViewBounds({ center: [-0.13, 51.51], zoom: 15, pitch: 60 }, screen);
    expect(tilted.east - tilted.west).toBeGreaterThan(flat.east - flat.west);
  });
});
