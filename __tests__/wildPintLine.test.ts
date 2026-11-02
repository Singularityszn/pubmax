import { describe, expect, it } from "vitest";

import {
  PINT_LINE_GEOMETRY,
  chooseOrientation,
  crossExtent,
  estimateTextWidth,
  layoutPintLine,
  routeLanes,
  wrapText,
  type MeasureText,
  type PintLineLayout,
  type PintLineStopInput,
  type Rect,
} from "@/lib/wildPintLine";

// The four named routes' real stops (public/data, read 2 October 2026), in order.
const VICTORIAN_SOHO: PintLineStopInput[] = [
  { name: "The Nellie Dean", point: [-0.133461, 51.5149], price: "£6.10", drink: "Heineken", leg: null },
  { name: "The Crown & Two Chairmen", point: [-0.132474, 51.5139], price: "£6.75", drink: "Estrella", leg: "~2 min" },
  { name: "The Dog & Duck", point: [-0.132014, 51.514], price: "£6.05", drink: "Amstel", leg: "~1 min" },
  { name: "The Coach & Horses", point: [-0.130129, 51.5133], price: "£5.70", drink: "Amstel", leg: "~2 min" },
  { name: "Golden Lion (Soho)", point: [-0.131572, 51.5125], price: "£6.40", drink: "Guinness", leg: "~2 min" },
];

const BOROUGH_MARKET: PintLineStopInput[] = [
  { name: "Katzenjammers", point: [-0.091374, 51.5049], price: "£6.60", drink: "Kingston Ale", leg: null },
  { name: "The Rake", point: [-0.0913283, 51.5062], price: "£6.30", drink: "Budweiser", leg: "~2 min" },
  { name: "George (Southwark)", point: [-0.089992, 51.5042], price: "£6.45", drink: "Bonkers Conkers", leg: "~4 min" },
  { name: "The Old King's Head", point: [-0.0890168, 51.5045], price: "£5.50", drink: "London Pride", leg: "~1 min" },
  { name: "The Barrowboy & Banker, SE1", point: [-0.088665, 51.5062], price: "£5.95", drink: "London Pride", leg: "~3 min" },
];

const FLEET_STREET: PintLineStopInput[] = [
  { name: "The Coal Hole", point: [-0.121216, 51.5104], price: "£6.35", drink: "Amstel", leg: null },
  { name: "The Lyceum Tavern", point: [-0.119747, 51.5113], price: "£5.60", drink: "Double Four Lager", leg: "~2 min" },
  { name: "The Seven Stars", point: [-0.113495, 51.515], price: "£6.50", drink: "Bitburger", leg: "~8 min" },
  { name: "The Old Bank of England", point: [-0.11152, 51.5139], price: "£6.80", drink: "Guinness", leg: "~3 min" },
  { name: "Ye Olde Cock Tavern", point: [-0.110492, 51.5137], price: "£6.35", drink: "Guinness", leg: "~1 min" },
  { name: "The Tipperary", point: [-0.107606, 51.5141], price: "£6.50", drink: "Guinness", leg: "~3 min" },
];

const LONG_NAMES = [
  "The Barrowboy & Banker, SE1",
  "The Crown & Two Chairmen",
  "Ye Olde Cheshire Cheese",
  "The Old Bank of England",
  "Katzenjammers",
  "The Lamb and Flag",
  "Golden Lion (Soho)",
  "The Prince Alfred & Formosa Dining Rooms",
];

/** A wandering route of `count` stops: east with a sideways zigzag, some with no price. */
function zigzag(count: number): PintLineStopInput[] {
  return Array.from({ length: count }, (_, i) => ({
    name: LONG_NAMES[i % LONG_NAMES.length]!,
    point: [-0.13 + i * 0.002, 51.51 + (i % 3 === 1 ? 0.0012 : i % 3 === 2 ? -0.0009 : 0)] as const,
    price: i % 4 === 3 ? null : `£${(5 + i * 0.35).toFixed(2)}`,
    drink: i % 2 === 0 ? "Bonkers Conkers" : "Double Four Lager",
    leg: i === 0 ? null : `~${3 + (i % 9)} min`,
  }));
}

const WIDTHS = [300, 326, 358, 600, 760, 912];

/** A measure 15% wider than the estimate, as a font that sets loose would. */
const LOOSE: MeasureText = (text, font) => estimateTextWidth(text, font) * 1.15;

function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
}

function circleTouchesRect(cx: number, cy: number, r: number, rect: Rect): boolean {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  return Math.hypot(cx - nx, cy - ny) < r;
}

function legRect(leg: PintLineLayout["legs"][number]): Rect {
  return { x: leg.x - leg.w / 2, y: leg.y - leg.h / 2, w: leg.w, h: leg.h };
}

/** Every point on the line, one pixel apart. */
function lineSamples(layout: PintLineLayout): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k < layout.vertices.length - 1; k++) {
    const [ax, ay] = layout.vertices[k]!;
    const [bx, by] = layout.vertices[k + 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let s = 0; s <= steps; s++) out.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
  }
  return out;
}

/** Every rule the drawing promises, checked on one layout. */
function expectReadable(layout: PintLineLayout, stops: PintLineStopInput[]): void {
  const g = PINT_LINE_GEOMETRY;
  const ring = g.stationRadius + g.stationStroke / 2;
  expect(layout.stations).toHaveLength(stops.length);
  expect(layout.labels).toHaveLength(stops.length);
  expect(layout.height).toBeGreaterThan(0);

  for (const label of layout.labels) {
    const { box } = label;
    // Inside the drawing.
    expect(box.x, `label ${label.index} left edge`).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.w, `label ${label.index} right edge`).toBeLessThanOrEqual(layout.width + 0.5);
    expect(box.y, `label ${label.index} top`).toBeGreaterThanOrEqual(-0.5);
    expect(box.y + box.h, `label ${label.index} bottom`).toBeLessThanOrEqual(layout.height + 0.5);
    // Clear of every station ring and every walk tag.
    for (const station of layout.stations) {
      expect(circleTouchesRect(station.x, station.y, ring + 1, box), `label ${label.index} on a station`).toBe(false);
    }
    for (const leg of layout.legs) {
      expect(rectsOverlap(box, legRect(leg)), `label ${label.index} on walk tag ${leg.index}`).toBe(false);
    }
  }

  // Clear of the line itself, by the thickness of what rides it.
  const samples = lineSamples(layout);
  for (const label of layout.labels) {
    const grown: Rect = {
      x: label.box.x - (g.clear - 1),
      y: label.box.y - (g.clear - 1),
      w: label.box.w + 2 * (g.clear - 1),
      h: label.box.h + 2 * (g.clear - 1),
    };
    const hit = samples.find(([x, y]) => x > grown.x && x < grown.x + grown.w && y > grown.y && y < grown.y + grown.h);
    expect(hit, `label ${label.index} (${stops[label.index]!.name}) on the line`).toBeUndefined();
  }

  // No two labels collide.
  for (let a = 0; a < layout.labels.length; a++) {
    for (let b = a + 1; b < layout.labels.length; b++) {
      expect(rectsOverlap(layout.labels[a]!.box, layout.labels[b]!.box), `labels ${a} and ${b}`).toBe(false);
    }
  }

  // Walk tags sit between rings, and the line and its glass stay in the drawing.
  for (const leg of layout.legs) {
    for (const station of layout.stations) {
      expect(circleTouchesRect(station.x, station.y, ring, legRect(leg)), `walk tag ${leg.index} on a station`).toBe(false);
    }
  }
  // The glass waits and rests on its stub, clear of the first and last ring:
  // it reaches 10.5px to each side, 19px up (its head) and 14.5px down.
  if (layout.stations.length > 0) {
    const first = layout.stations[0]!;
    const last = layout.stations[layout.stations.length - 1]!;
    const tall = layout.orientation === "vertical";
    expect(Math.hypot(layout.end[0] - last.x, layout.end[1] - last.y)).toBeGreaterThanOrEqual(ring + (tall ? 19 : 10.5));
    expect(Math.hypot(layout.start[0] - first.x, layout.start[1] - first.y)).toBeGreaterThanOrEqual(
      ring + (tall ? 14.5 : 10.5),
    );
  }
  for (const [x, y] of [...layout.vertices, layout.start, layout.end]) {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(layout.width);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(layout.height);
  }
}

describe("the Pint Line layout", () => {
  for (let count = 2; count <= 8; count++) {
    for (const width of WIDTHS) {
      it(`keeps ${count} stops readable at ${width}px`, () => {
        const stops = zigzag(count);
        expectReadable(layoutPintLine(stops, { width }), stops);
        expectReadable(layoutPintLine(stops, { width, measure: LOOSE }), stops);
      });
    }
  }

  for (const [name, stops] of [
    ["Victorian Soho", VICTORIAN_SOHO],
    ["Borough Market", BOROUGH_MARKET],
    ["Fleet Street", FLEET_STREET],
  ] as const) {
    for (const width of WIDTHS) {
      it(`draws ${name} readably at ${width}px`, () => {
        expectReadable(layoutPintLine(stops, { width }), stops);
      });
    }
  }

  it("runs down a phone and across a desktop", () => {
    expect(layoutPintLine(VICTORIAN_SOHO, { width: 326 }).orientation).toBe("vertical");
    expect(layoutPintLine(VICTORIAN_SOHO, { width: 912 }).orientation).toBe("horizontal");
    expect(layoutPintLine(zigzag(3), { width: 358 }).orientation).toBe("horizontal");
    expect(layoutPintLine(zigzag(8), { width: 912 }).orientation).toBe("horizontal");
    expect(chooseOrientation(8, 600)).toBe("vertical");
    expect(chooseOrientation(2, 300)).toBe("horizontal");
  });

  it("alternates label sides, so neighbours never share one", () => {
    const wide = layoutPintLine(VICTORIAN_SOHO, { width: 912 });
    expect(wide.labels.map((label) => label.side)).toEqual(["above", "below", "above", "below", "above"]);
    const tall = layoutPintLine(VICTORIAN_SOHO, { width: 326 });
    expect(tall.labels.map((label) => label.side)).toEqual(["right", "left", "right", "left", "right"]);
  });

  it("bends where the real route turns, and keeps every bend one diagonal", () => {
    const soho = layoutPintLine(VICTORIAN_SOHO, { width: 912 });
    expect(new Set(soho.stations.map((station) => station.lane)).size).toBeGreaterThan(1);
    expect(soho.path).toMatch(/Q/);
    const fleet = layoutPintLine(FLEET_STREET, { width: 326 });
    expect(new Set(fleet.stations.map((station) => station.lane)).size).toBeGreaterThan(1);
    for (let i = 1; i < fleet.stations.length; i++) {
      expect(Math.abs(fleet.stations[i]!.lane - fleet.stations[i - 1]!.lane)).toBeLessThanOrEqual(1);
    }
  });

  it("puts every walk time on its own leg, between the two stops", () => {
    const layout = layoutPintLine(VICTORIAN_SOHO, { width: 912 });
    expect(layout.legs.map((leg) => [leg.index, leg.text])).toEqual([
      [1, "~2 min"],
      [2, "~1 min"],
      [3, "~2 min"],
      [4, "~2 min"],
    ]);
    for (const leg of layout.legs) {
      const a = layout.stations[leg.index - 1]!;
      const b = layout.stations[leg.index]!;
      expect(leg.x).toBeGreaterThan(Math.min(a.x, b.x));
      expect(leg.x).toBeLessThan(Math.max(a.x, b.x));
    }
  });

  it("says a missing price in words, and carries every price it was given", () => {
    const stops = zigzag(4);
    const layout = layoutPintLine(stops, { width: 358 });
    const details = layout.labels.map((label) => label.lines.filter((line) => line.kind === "detail"));
    expect(details[3]!.every((line) => line.kind === "detail" && line.missing)).toBe(true);
    expect(details[3]!.map((line) => (line.kind === "detail" ? line.text : "")).join(" ")).toBe("No price listed");
    for (const i of [0, 1, 2]) {
      expect(details[i]!.some((line) => line.kind === "detail" && line.price === stops[i]!.price)).toBe(true);
    }
  });

  it("draws one stop as a station with no walk", () => {
    const layout = layoutPintLine(VICTORIAN_SOHO.slice(0, 1), { width: 358 });
    expect(layout.stations).toHaveLength(1);
    expect(layout.legs).toEqual([]);
    expect(layout.labels).toHaveLength(1);
  });
});

describe("the lanes", () => {
  it("keep a straight route on one line", () => {
    const straight = Array.from({ length: 6 }, (_, i) => [-0.13 + i * 0.001, 51.51 + i * 0.0005] as const);
    expect(routeLanes(straight, 2, 2)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("put a stop off to the left of travel on a positive lane", () => {
    // Heading east; the middle stop is north of the line, which is to the left.
    const lanes = routeLanes(
      [
        [-0.13, 51.51],
        [-0.129, 51.512],
        [-0.128, 51.51],
      ],
      2,
      2,
    );
    expect(lanes).toEqual([0, 2, 0]);
  });

  it("hold a jump to one lane when asked, and keep the lane before a stop it cannot place", () => {
    const lanes = routeLanes(
      [
        [-0.13, 51.51],
        [-0.129, 51.512],
        null,
        [-0.127, 51.51],
      ],
      2,
      1,
    );
    expect(lanes).toEqual([0, 1, 1, 0]);
  });

  it("read a loop against its longest reach", () => {
    const loop = routeLanes(
      [
        [-0.13, 51.51],
        [-0.128, 51.511],
        [-0.126, 51.51],
        [-0.13, 51.51],
      ],
      1,
      1,
    );
    expect(loop.some((lane) => lane !== 0)).toBe(true);
  });
});

describe("the measuring helpers", () => {
  it("wraps by words and never splits one", () => {
    const lines = wrapText("The Barrowboy & Banker, SE1", 110, "name", estimateTextWidth);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("The Barrowboy & Banker, SE1");
    for (const line of lines) expect(estimateTextWidth(line, "name")).toBeLessThanOrEqual(110);
    expect(wrapText("Katzenjammers", 20, "name", estimateTextWidth)).toEqual(["Katzenjammers"]);
  });

  it("reads the line's sideways extent over a stretch", () => {
    const line: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [20, 10],
      [30, 10],
    ];
    expect(crossExtent(line, 0, 0, 10)).toEqual({ min: 0, max: 0 });
    expect(crossExtent(line, 0, 5, 25)).toEqual({ min: 0, max: 10 });
    expect(crossExtent(line, 0, 15, 15)).toEqual({ min: 5, max: 5 });
  });
});
