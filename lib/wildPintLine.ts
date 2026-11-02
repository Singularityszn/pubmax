// THE PINT LINE LAYOUT (wild idea 02, docs/plans/DESIGN_UX_PLAN.md section 12).
//
// A crawl drawn as a line diagram in our own style: the pubs are stations in
// crawl order, the walk is the track, and each station carries its name and
// its listed pint. This module is the geometry and nothing else. It is pure,
// so it is tested with fixtures, and the component only paints what it says.
//
// The rules it keeps:
//   1. ORDER IS THE AXIS. Stations are evenly spaced in crawl order, left to
//      right on a wide screen and top to bottom on a narrow one.
//   2. THE LINE BENDS WHERE THE ROUTE TURNS. Each stop's sideways offset from
//      the straight line between the first and last stop (its real position,
//      in metres) picks a lane, and a lane change is drawn as a 45 degree
//      diagonal with rounded corners. A route that runs straight stays one
//      straight line.
//   3. LABELS NEVER COLLIDE. Labels alternate sides (above and below, or right
//      and left), so two labels on one side are two stations apart, and each
//      label is wrapped to the room between them. Each label then stands clear
//      of the line, the stations and the walk times by a fixed gap.
//   4. IT FITS. A wide layout is chosen only when every station gets at least
//      MIN_STEP of room; otherwise the line runs down the screen.

export type PintLineFont = "name" | "price" | "drink" | "leg";

/** The type the layout measures and the stylesheet sets, in CSS pixels. */
export const PINT_LINE_TYPE: Readonly<
  Record<PintLineFont, { size: number; weight: number; face: "display" | "body" | "data"; lineHeight: number }>
> = {
  name: { size: 14, weight: 700, face: "display", lineHeight: 17 },
  price: { size: 13, weight: 700, face: "data", lineHeight: 16 },
  drink: { size: 12.5, weight: 500, face: "body", lineHeight: 16 },
  leg: { size: 11, weight: 600, face: "data", lineHeight: 14 },
};

export const PINT_LINE_GEOMETRY = {
  /** Station circle radius and ring width. */
  stationRadius: 12,
  stationStroke: 4,
  lineWidth: 10,
  /** Half the thickness of everything that rides the line: a station ring, the glass. */
  clear: 17,
  /** Space between a label and anything it stands clear of. */
  gap: 7,
  /**
   * The short run of line before the first and after the last station, where
   * the glass waits. Running down, the glass is taller than it is wide, so its
   * stub is longer.
   */
  stub: 30,
  stubTall: 40,
  /** Space inside the drawing's edge. */
  pad: 6,
  laneGapH: 30,
  laneGapV: 26,
  /** The least room a station gets on a wide layout. */
  minStep: 112,
  maxStep: 236,
  /** The least room a station gets on a tall layout. */
  minRow: 84,
  maxLabel: 212,
  /** Space between two labels on the same side. */
  slotGap: 14,
  cornerRadius: 12,
  legHeight: 20,
  legPadX: 8,
} as const;

export type MeasureText = (text: string, font: PintLineFont) => number;

/**
 * A width estimate for when the real fonts cannot be measured (tests, and the
 * first frame before the faces load). It errs wide, so a label laid out with
 * it never overflows the room it was given once the real face arrives.
 */
export function estimateTextWidth(text: string, font: PintLineFont): number {
  const type = PINT_LINE_TYPE[font];
  if (type.face === "data") return text.length * type.size * 0.62;
  let em = 0;
  for (const ch of text) {
    if (ch === " " || ch === " ") em += 0.28;
    else if (/[ilj.,:;'’|!]/.test(ch)) em += 0.3;
    else if (/[ftr()-]/.test(ch)) em += 0.38;
    else if (/[mwMW]/.test(ch)) em += 0.88;
    else if (/[A-Z&]/.test(ch)) em += 0.7;
    else if (/[0-9£]/.test(ch)) em += 0.62;
    else em += 0.58;
  }
  return em * type.size * (type.weight >= 700 ? 1.04 : 1);
}

/** Greedy word wrap. A single word wider than the room keeps a line of its own. */
export function wrapText(text: string, maxWidth: number, font: PintLineFont, measure: MeasureText): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || measure(next, font) <= maxWidth) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export type PintLineStopInput = {
  /** [longitude, latitude], or null when the stop cannot be placed. */
  point: readonly [number, number] | null;
  name: string;
  /** The listed pint, "£6.10", or null when the stop has none. */
  price: string | null;
  drink: string | null;
  /** Shown in place of a price when there is none. */
  missingText?: string;
  /** The walk-time tag for the leg INTO this stop, or null. Ignored on the first stop. */
  leg: string | null;
};

export type Rect = { x: number; y: number; w: number; h: number };

type PintLineTextLine =
  | { kind: "name"; text: string; y: number }
  | { kind: "detail"; price: string | null; text: string | null; missing: boolean; y: number };

type PintLineLabel = {
  index: number;
  side: "above" | "below" | "left" | "right";
  anchor: "start" | "middle" | "end";
  /** The x every line of the label is anchored at. */
  x: number;
  lines: PintLineTextLine[];
  box: Rect;
};

type PintLineStation = { x: number; y: number; lane: number };

type PintLineLeg = {
  /** The stop the leg arrives at. */
  index: number;
  text: string;
  /** Centre of the tag. */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PintLineLayout = {
  orientation: "horizontal" | "vertical";
  width: number;
  height: number;
  stations: PintLineStation[];
  /** The line's corners, unrounded: from the start of the first stub to the end of the last. */
  vertices: Array<[number, number]>;
  /** The line as an SVG path, corners rounded. */
  path: string;
  labels: PintLineLabel[];
  legs: PintLineLeg[];
  /** Where the glass waits before it sets off, and where it comes to rest. */
  start: [number, number];
  end: [number, number];
};

export type PintLineOptions = {
  /** The width to draw in, CSS pixels. */
  width: number;
  measure?: MeasureText;
  orientation?: "auto" | "horizontal" | "vertical";
};

type Point = readonly [number, number];

/**
 * The lane of each stop: its sideways offset from the straight line between
 * the first and last placed stop, scaled so the furthest stop sits on the
 * outer lane. Positive is to the left of the direction of travel. A stop that
 * cannot be placed keeps the lane before it. A jump between neighbours is
 * held to `maxJump`, so every bend fits between two stations.
 */
export function routeLanes(points: ReadonlyArray<Point | null>, maxLanes: number, maxJump: number): number[] {
  const lanes = points.map(() => 0);
  const placed = points.flatMap((point, index) => (point ? [{ index, point }] : []));
  if (placed.length < 3 || maxLanes <= 0) return lanes;
  const origin = placed[0]!.point;
  const scaleX = Math.cos((origin[1] * Math.PI) / 180) * 111_320;
  const toMetres = (point: Point): [number, number] => [
    (point[0] - origin[0]) * scaleX,
    (point[1] - origin[1]) * 110_540,
  ];
  let [dx, dy] = toMetres(placed[placed.length - 1]!.point);
  let length = Math.hypot(dx, dy);
  if (length < 1) {
    // A loop that ends where it began: read the turns against its longest reach.
    for (const { point } of placed) {
      const [x, y] = toMetres(point);
      if (Math.hypot(x, y) > length) {
        [dx, dy] = [x, y];
        length = Math.hypot(x, y);
      }
    }
    if (length < 1) return lanes;
  }
  const ux = dx / length;
  const uy = dy / length;
  const offsets = points.map((point) => {
    if (!point) return null;
    const [x, y] = toMetres(point);
    return x * -uy + y * ux;
  });
  const furthest = Math.max(...offsets.map((offset) => Math.abs(offset ?? 0)));
  // A route that never strays far from its own straight line is drawn straight.
  if (furthest < Math.max(length * 0.12, 15)) return lanes;
  let previous = 0;
  return offsets.map((offset, index) => {
    let lane = offset === null ? previous : Math.round((offset / furthest) * maxLanes) + 0;
    if (index > 0) lane = Math.min(previous + maxJump, Math.max(previous - maxJump, lane));
    previous = lane;
    return lane;
  });
}

/** Round each corner of a polyline with a quadratic curve. */
function roundedPath(vertices: ReadonlyArray<Point>, radius: number): string {
  const f = (value: number) => Number(value.toFixed(1));
  if (vertices.length === 0) return "";
  const [first, ...rest] = vertices;
  let d = `M${f(first![0])} ${f(first![1])}`;
  for (let k = 1; k < vertices.length - 1; k++) {
    const p = vertices[k - 1]!;
    const v = vertices[k]!;
    const n = vertices[k + 1]!;
    const inLength = Math.hypot(v[0] - p[0], v[1] - p[1]);
    const outLength = Math.hypot(n[0] - v[0], n[1] - v[1]);
    const cross = (v[0] - p[0]) * (n[1] - v[1]) - (v[1] - p[1]) * (n[0] - v[0]);
    if (inLength < 0.01 || outLength < 0.01 || Math.abs(cross) < 0.01) {
      d += ` L${f(v[0])} ${f(v[1])}`;
      continue;
    }
    const r = Math.min(radius, inLength / 2, outLength / 2);
    const a: Point = [v[0] + ((p[0] - v[0]) / inLength) * r, v[1] + ((p[1] - v[1]) / inLength) * r];
    const b: Point = [v[0] + ((n[0] - v[0]) / outLength) * r, v[1] + ((n[1] - v[1]) / outLength) * r];
    d += ` L${f(a[0])} ${f(a[1])} Q${f(v[0])} ${f(v[1])} ${f(b[0])} ${f(b[1])}`;
  }
  if (rest.length > 0) {
    const last = vertices[vertices.length - 1]!;
    d += ` L${f(last[0])} ${f(last[1])}`;
  }
  return d;
}

/**
 * The least and greatest cross-axis value of the line over a stretch of the
 * travel axis. `along` is 0 when the line runs left to right, 1 when it runs
 * down. The travel axis only ever increases along the line.
 */
export function crossExtent(
  vertices: ReadonlyArray<Point>,
  along: 0 | 1,
  from: number,
  to: number,
): { min: number; max: number } {
  const across = along === 0 ? 1 : 0;
  let min = Infinity;
  let max = -Infinity;
  const take = (value: number) => {
    min = Math.min(min, value);
    max = Math.max(max, value);
  };
  for (let k = 0; k < vertices.length - 1; k++) {
    const a = vertices[k]!;
    const b = vertices[k + 1]!;
    const lo = Math.min(a[along], b[along]);
    const hi = Math.max(a[along], b[along]);
    if (hi < from || lo > to) continue;
    if (hi - lo < 1e-6) {
      take(a[across]);
      take(b[across]);
      continue;
    }
    for (const c of [Math.max(from, lo), Math.min(to, hi)]) {
      const t = (c - a[along]) / (b[along] - a[along]);
      take(a[across] + (b[across] - a[across]) * t);
    }
  }
  if (!Number.isFinite(min) && vertices.length > 0) {
    const first = vertices[0]!;
    const last = vertices[vertices.length - 1]!;
    const nearest = Math.abs(first[along] - from) < Math.abs(last[along] - to) ? first : last;
    take(nearest[across]);
  }
  return { min, max };
}

function overlaps(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return aFrom < bTo && bFrom < aTo;
}

type Draft = {
  lines: Array<
    | { kind: "name"; text: string; dy: number; width: number }
    | { kind: "detail"; price: string | null; text: string | null; missing: boolean; dy: number; width: number }
  >;
  width: number;
  height: number;
};

const NAME = PINT_LINE_TYPE.name;
const DETAIL_LINE = PINT_LINE_TYPE.drink.lineHeight;
const NAME_BASELINE = 13;
const DETAIL_BASELINE = 12.5;
const NAME_TO_DETAIL = 3;

/** The words of one label, wrapped to `maxWidth`, with each line's baseline offset. */
function draftLabel(stop: PintLineStopInput, maxWidth: number, measure: MeasureText): Draft {
  const lines: Draft["lines"] = [];
  let top = 0;
  for (const text of wrapText(stop.name, maxWidth, "name", measure)) {
    lines.push({ kind: "name", text, dy: top + NAME_BASELINE, width: measure(text, "name") });
    top += NAME.lineHeight;
  }
  top += NAME_TO_DETAIL;
  const pushDetail = (price: string | null, text: string | null, missing: boolean, width: number) => {
    lines.push({ kind: "detail", price, text, missing, dy: top + DETAIL_BASELINE, width });
    top += DETAIL_LINE;
  };
  if (stop.price) {
    const priceWidth = measure(stop.price, "price");
    const drink = stop.drink?.trim() || null;
    const together = drink ? priceWidth + measure(` ${drink}`, "drink") : priceWidth;
    if (!drink || together <= maxWidth) {
      pushDetail(stop.price, drink, false, together);
    } else {
      pushDetail(stop.price, null, false, priceWidth);
      for (const text of wrapText(drink, maxWidth, "drink", measure)) {
        pushDetail(null, text, false, measure(text, "drink"));
      }
    }
  } else {
    for (const text of wrapText(stop.missingText ?? "No price listed", maxWidth, "drink", measure)) {
      pushDetail(null, text, true, measure(text, "drink"));
    }
  }
  return { lines, width: Math.max(...lines.map((line) => line.width)), height: top };
}

function placeLines(draft: Draft, top: number): PintLineTextLine[] {
  return draft.lines.map((line) =>
    line.kind === "name"
      ? { kind: "name", text: line.text, y: top + line.dy }
      : { kind: "detail", price: line.price, text: line.text, missing: line.missing, y: top + line.dy },
  );
}

function legTag(stop: PintLineStopInput, index: number, room: number, horizontal: boolean, measure: MeasureText) {
  if (index === 0 || !stop.leg) return null;
  const g = PINT_LINE_GEOMETRY;
  const w = Math.ceil(measure(stop.leg, "leg") + 2 * g.legPadX);
  const along = horizontal ? w : g.legHeight;
  // The tag must sit between two station rings, never on one.
  if (along > room - 2 * (g.stationRadius + g.stationStroke) - 6) return null;
  return { text: stop.leg, w, h: g.legHeight };
}

export function chooseOrientation(
  count: number,
  width: number,
  wanted: PintLineOptions["orientation"] = "auto",
): "horizontal" | "vertical" {
  if (wanted === "horizontal" || wanted === "vertical") return wanted;
  if (count <= 1) return "horizontal";
  const g = PINT_LINE_GEOMETRY;
  const room = width - 2 * (g.pad + g.stub + g.stationRadius);
  return room / (count - 1) >= g.minStep ? "horizontal" : "vertical";
}

export function layoutPintLine(stops: readonly PintLineStopInput[], options: PintLineOptions): PintLineLayout {
  const width = Math.max(240, Math.floor(options.width));
  const measure = options.measure ?? estimateTextWidth;
  const orientation = chooseOrientation(stops.length, width, options.orientation);
  return orientation === "horizontal"
    ? layoutHorizontal(stops, width, measure)
    : layoutVertical(stops, width, measure);
}

function finish(
  draft: Omit<PintLineLayout, "height" | "path">,
  minY: number,
  maxY: number,
): PintLineLayout {
  const g = PINT_LINE_GEOMETRY;
  const shift = g.pad - minY;
  const move = (y: number) => y + shift;
  const vertices = draft.vertices.map(([x, y]) => [x, move(y)] as [number, number]);
  return {
    ...draft,
    height: Math.ceil(maxY - minY + 2 * g.pad),
    stations: draft.stations.map((station) => ({ ...station, y: move(station.y) })),
    vertices,
    path: roundedPath(vertices, g.cornerRadius),
    labels: draft.labels.map((label) => ({
      ...label,
      lines: label.lines.map((line) => ({ ...line, y: move(line.y) })),
      box: { ...label.box, y: move(label.box.y) },
    })),
    legs: draft.legs.map((leg) => ({ ...leg, y: move(leg.y) })),
    start: [draft.start[0], move(draft.start[1])],
    end: [draft.end[0], move(draft.end[1])],
  };
}

function layoutHorizontal(stops: readonly PintLineStopInput[], width: number, measure: MeasureText): PintLineLayout {
  const g = PINT_LINE_GEOMETRY;
  const n = stops.length;
  const ring = g.stationRadius + g.stationStroke / 2;
  const room = width - 2 * (g.pad + g.stub + g.stationRadius);
  const step = n > 1 ? Math.min(g.maxStep, room / (n - 1)) : 0;
  const x0 = (width - step * Math.max(0, n - 1)) / 2;
  const maxJump = Math.max(1, Math.min(2, Math.floor((step - 2 * ring - 2 * g.cornerRadius) / g.laneGapH)));
  const lanes = routeLanes(
    stops.map((stop) => stop.point),
    2,
    maxJump,
  );
  const stations: PintLineStation[] = stops.map((_, i) => ({ x: x0 + i * step, y: -lanes[i]! * g.laneGapH, lane: lanes[i]! }));

  const vertices: Array<[number, number]> = [];
  if (n > 0) vertices.push([stations[0]!.x - g.stub, stations[0]!.y]);
  stations.forEach((station, i) => {
    vertices.push([station.x, station.y]);
    const next = stations[i + 1];
    if (next && next.y !== station.y) {
      const mid = (station.x + next.x) / 2;
      const half = Math.abs(next.y - station.y) / 2;
      vertices.push([mid - half, station.y], [mid + half, next.y]);
    }
  });
  if (n > 0) vertices.push([stations[n - 1]!.x + g.stub, stations[n - 1]!.y]);

  const legs: PintLineLeg[] = [];
  stops.forEach((stop, i) => {
    const tag = legTag(stop, i, step, true, measure);
    if (!tag) return;
    const a = stations[i - 1]!;
    const b = stations[i]!;
    legs.push({ index: i, text: tag.text, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: tag.w, h: tag.h });
  });

  const labels: PintLineLabel[] = stops.map((stop, i) => {
    const station = stations[i]!;
    const side = i % 2 === 0 ? "above" : "below";
    const slotL = i - 2 >= 0 ? station.x - step + g.slotGap / 2 : g.pad;
    const slotR = i + 2 <= n - 1 ? station.x + step - g.slotGap / 2 : width - g.pad;
    const draft = draftLabel(stop, Math.min(g.maxLabel, slotR - slotL), measure);
    const w = Math.min(draft.width, slotR - slotL);
    const centred = station.x - w / 2;
    const left = Math.min(Math.max(centred, slotL), slotR - w);
    const anchor: PintLineLabel["anchor"] = left > centred + 0.5 ? "start" : left < centred - 0.5 ? "end" : "middle";
    const x = anchor === "start" ? left : anchor === "end" ? left + w : station.x;
    // The stretch a label must stand clear over runs past its own ends by the
    // line's half-thickness, so a bend just beside a label cannot graze it.
    const from = left - g.clear;
    const to = left + w + g.clear;
    const extent = crossExtent(vertices, 0, from, to);
    let top: number;
    if (side === "above") {
      let edge = extent.min - g.clear;
      for (const leg of legs) {
        if (overlaps(from, to, leg.x - leg.w / 2, leg.x + leg.w / 2)) edge = Math.min(edge, leg.y - leg.h / 2);
      }
      top = edge - g.gap - draft.height;
    } else {
      let edge = extent.max + g.clear;
      for (const leg of legs) {
        if (overlaps(from, to, leg.x - leg.w / 2, leg.x + leg.w / 2)) edge = Math.max(edge, leg.y + leg.h / 2);
      }
      top = edge + g.gap;
    }
    return {
      index: i,
      side,
      anchor,
      x,
      lines: placeLines(draft, top),
      box: { x: left, y: top, w, h: draft.height },
    };
  });

  const lineMin = Math.min(...vertices.map(([, y]) => y)) - g.clear;
  const lineMax = Math.max(...vertices.map(([, y]) => y)) + g.clear;
  const minY = Math.min(lineMin, ...labels.map((label) => label.box.y));
  const maxY = Math.max(lineMax, ...labels.map((label) => label.box.y + label.box.h));
  const first = vertices[0] ?? [width / 2, 0];
  const last = vertices[vertices.length - 1] ?? first;
  return finish(
    {
      orientation: "horizontal",
      width,
      stations,
      vertices,
      labels,
      legs,
      start: [first[0], first[1]],
      end: [last[0], last[1]],
    },
    minY,
    maxY,
  );
}

function layoutVertical(stops: readonly PintLineStopInput[], width: number, measure: MeasureText): PintLineLayout {
  const g = PINT_LINE_GEOMETRY;
  const n = stops.length;
  const maxLanes = width >= 520 ? 2 : 1;
  const centre = width / 2;
  const lanes = routeLanes(
    stops.map((stop) => stop.point),
    maxLanes,
    1,
  );
  const xs = lanes.map((lane) => centre + lane * g.laneGapV);
  const laneMin = centre - maxLanes * g.laneGapV;
  const laneMax = centre + maxLanes * g.laneGapV;

  // First pass: wrap every label to the room left beside the widest the line
  // can be, so the row height can hold the tallest of them.
  const sideOf = (i: number): "right" | "left" => (i % 2 === 0 ? "right" : "left");
  const roomFor = (i: number, edge: number) =>
    Math.min(g.maxLabel, sideOf(i) === "right" ? width - g.pad - edge : edge - g.pad);
  const conservativeEdge = (i: number) =>
    sideOf(i) === "right" ? laneMax + g.clear + g.gap : laneMin - g.clear - g.gap;
  const drafts = stops.map((stop, i) => draftLabel(stop, roomFor(i, conservativeEdge(i)), measure));
  const tallest = Math.max(0, ...drafts.map((draft) => draft.height));
  const row = Math.ceil(Math.max(g.minRow, tallest + g.legHeight + 2 * g.gap + 2));

  const stations: PintLineStation[] = stops.map((_, i) => ({ x: xs[i]!, y: i * row, lane: lanes[i]! }));
  const vertices: Array<[number, number]> = [];
  if (n > 0) vertices.push([stations[0]!.x, stations[0]!.y - g.stubTall]);
  stations.forEach((station, i) => {
    vertices.push([station.x, station.y]);
    const next = stations[i + 1];
    if (next && next.x !== station.x) {
      const mid = (station.y + next.y) / 2;
      const half = Math.abs(next.x - station.x) / 2;
      vertices.push([station.x, mid - half], [next.x, mid + half]);
    }
  });
  if (n > 0) vertices.push([stations[n - 1]!.x, stations[n - 1]!.y + g.stubTall]);

  const legs: PintLineLeg[] = [];
  stops.forEach((stop, i) => {
    const tag = legTag(stop, i, row, false, measure);
    if (!tag) return;
    const a = stations[i - 1]!;
    const b = stations[i]!;
    legs.push({ index: i, text: tag.text, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: tag.w, h: tag.h });
  });

  // Second pass: stand each label clear of what is actually beside it, and
  // wrap again to the room that leaves. A narrower room only ever makes a
  // label taller, so the pass repeats until nothing moves.
  const labels: PintLineLabel[] = stops.map((stop, i) => {
    const station = stations[i]!;
    const side = sideOf(i);
    let draft = drafts[i]!;
    let edge = conservativeEdge(i);
    for (let pass = 0; pass < 4; pass++) {
      const top = station.y - draft.height / 2;
      const bottom = top + draft.height;
      const extent = crossExtent(vertices, 1, top - g.clear, bottom + g.clear);
      let next = side === "right" ? extent.max + g.clear + g.gap : extent.min - g.clear - g.gap;
      for (const leg of legs) {
        if (!overlaps(top - g.clear, bottom + g.clear, leg.y - leg.h / 2, leg.y + leg.h / 2)) continue;
        next = side === "right" ? Math.max(next, leg.x + leg.w / 2 + g.gap) : Math.min(next, leg.x - leg.w / 2 - g.gap);
      }
      const redraft = draftLabel(stop, roomFor(i, next), measure);
      const settled = Math.abs(next - edge) < 0.5 && redraft.height === draft.height;
      edge = next;
      draft = redraft;
      if (settled) break;
    }
    const w = Math.min(draft.width, roomFor(i, edge));
    const top = station.y - draft.height / 2;
    const left = side === "right" ? edge : edge - w;
    return {
      index: i,
      side,
      anchor: side === "right" ? "start" : "end",
      x: edge,
      lines: placeLines(draft, top),
      box: { x: left, y: top, w, h: draft.height },
    };
  });

  const lineMin = (vertices[0]?.[1] ?? 0) - g.clear;
  const lineMax = (vertices[vertices.length - 1]?.[1] ?? 0) + g.clear;
  const minY = Math.min(lineMin, ...labels.map((label) => label.box.y));
  const maxY = Math.max(lineMax, ...labels.map((label) => label.box.y + label.box.h));
  const first = vertices[0] ?? [centre, 0];
  const last = vertices[vertices.length - 1] ?? first;
  return finish(
    {
      orientation: "vertical",
      width,
      stations,
      vertices,
      labels,
      legs,
      start: [first[0], first[1]],
      end: [last[0], last[1]],
    },
    minY,
    maxY,
  );
}
