#!/usr/bin/env node
// Draw the landing's map of London, once, at build time.
//
// Captain 7 Sep 2026: the front door shows the places to visit and the historic
// pubs, and it shows them fast. The live MapLibre canvas cannot do that: it
// costs a WebGL context, a style, a font stack and megabytes of tiles before a
// stranger sees anything. So the landing gets a DRAWING instead, generated from
// the two datasets this repository already ships, and the live map stays one
// tap away.
//
// THREE RULES.
//
// (1) EVERY MARK IS A REAL PLACE. The outlines are the 33 London boroughs from
//     data/london_boroughs_simplified.json. Every dot is one pub from
//     public/data/historic_pubs.json with real coordinates. Nothing here is
//     decoration shaped like data.
//
// (2) THE NAMED PINS ARE PICKED BY A RULE, NOT BY HAND. A pin is a sourced
//     historic pub with a year we can print, oldest first, apart from every
//     other named pin, and written clear of every named pin's mark and writing;
//     at most six of them. Re-run the script after the heritage data changes and
//     the pins follow the data rather than somebody's taste.
//
// (3) THE GENERATED MODULE RETAINS THE HISTORIC PUB COUNT used by the landing
//     and OG copy. The outline and pin data remain checked for source fidelity
//     in __tests__/landingMapSnapshot.test.ts.
//
// Usage: node scripts/landing/build-landing-map.mjs

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const BOROUGHS = path.join(ROOT, "data", "london_boroughs_simplified.json");
const HISTORIC = path.join(ROOT, "public", "data", "historic_pubs.json");
const OUT = path.join(ROOT, "components", "landing", "londonMapGeometry.ts");

// The frame. Inner London, wide enough to hold every named pin and to read as
// London at 390px, tight enough that a pub dot is a pub rather than a speck.
const FRAME = { west: -0.325, east: 0.06, south: 51.415, north: 51.585 };
const WIDTH = 1200;
// Latitude degrees are longer than longitude degrees this far north, so the
// height is the frame's own aspect rather than a number somebody liked.
const LAT_MID = (FRAME.south + FRAME.north) / 2;
const LON_SCALE = Math.cos((LAT_MID * Math.PI) / 180);
const HEIGHT = Math.round(
  (WIDTH * (FRAME.north - FRAME.south)) / ((FRAME.east - FRAME.west) * LON_SCALE),
);
/**
 * The CAP on named pins. The separation rule and the clear-writing rule below
 * decide how many of them the data can actually seat: past this the labels
 * start to touch on a 390px phone.
 */
const PIN_COUNT = 6;
/**
 * How far apart two named pins must sit, in user units. Four of the oldest
 * dated pubs stand within a few hundred metres of Fleet Street, so a
 * one-per-borough rule still put four labels on top of each other. Separation
 * replaces it: it is measured on the drawing rather than on the ground, because
 * what must not collide is the writing, and it spreads the six by construction.
 */
const PIN_SEPARATION_UNITS = 150;
/** How close in y two labels have to be before they can share a line of text. */
const LABEL_LINE_UNITS = 80;
/** Drop a borough vertex this close to the last one kept, in user units. */
const SIMPLIFY_UNITS = 6;
/** The radius a pub dot is drawn at, in user units. */
const DOT_RADIUS = 4.5;
/** A named pin's own mark: the circle's radius plus half its stroke. */
const PIN_MARK_RADIUS = 9.5;
/**
 * Where a pin's writing may sit, tried in this order: beside the pin, then
 * just above it, then just below. `dx` is how far along the line the writing
 * starts from the pin and `dy` how far the two lines move up or down;
 * The generated pin retains both values for source-fidelity checks.
 */
const PLACEMENTS = [
  { dx: 18, dy: 0 },
  { dx: 4, dy: -44 },
  { dx: 4, dy: 40 },
];
/**
 * The box each line of a pin's writing takes, from the pin's centre before
 * `dy`. Top and bottom are the fonts' own ascent and descent at .lpMapPinName
 * (27px Space Grotesk Bold, baseline -2) and .lpMapPinLabel (22px JetBrains
 * Mono, baseline 24). The width per character is wider than either font runs:
 * Chromium measured 0.50 to 0.52 em for the names and 0.60 em for the dates on
 * 14 Sep 2026, so writing this script seats is clear in the browser too.
 */
const NAME_BOX = { size: 27, em: 0.56, top: -30, bottom: 7 };
const DATE_BOX = { size: 22, em: 0.62, top: 1, bottom: 31 };
/** Clear space kept between writing and the drawing's edge, in user units. */
const FRAME_INSET = 8;

function projectX(lng) {
  return ((lng - FRAME.west) / (FRAME.east - FRAME.west)) * WIDTH;
}
function projectY(lat) {
  return ((FRAME.north - lat) / (FRAME.north - FRAME.south)) * HEIGHT;
}

/** Does this ring come anywhere near the frame the drawing shows? */
function ringTouchesFrame(points) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return east >= FRAME.west && west <= FRAME.east && north >= FRAME.south && south <= FRAME.north;
}

function ring(points) {
  const kept = [];
  for (const [lng, lat] of points) {
    const x = projectX(lng);
    const y = projectY(lat);
    const last = kept[kept.length - 1];
    if (last && Math.hypot(x - last[0], y - last[1]) < SIMPLIFY_UNITS) continue;
    kept.push([x, y]);
  }
  if (kept.length < 4) return "";
  return `M${kept.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`).join("L")}Z`;
}

function boroughPath(features) {
  const parts = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    // The outer ring alone: a borough's holes are enclaves nobody can read at
    // this size, and they cost bytes on a document every stranger downloads.
    const polygons =
      geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
    for (const polygon of polygons) {
      // A borough the frame never shows costs bytes on every landing document
      // and paints nothing, so it is dropped rather than clipped.
      if (!ringTouchesFrame(polygon[0])) continue;
      const drawn = ring(polygon[0]);
      if (drawn) parts.push(drawn);
    }
  }
  return parts.join("");
}

function insideFrame(pub) {
  return (
    Number.isFinite(pub.lat) &&
    Number.isFinite(pub.lng) &&
    pub.lng >= FRAME.west &&
    pub.lng <= FRAME.east &&
    pub.lat >= FRAME.south &&
    pub.lat <= FRAME.north
  );
}

/**
 * The year a dated row sorts by. A row dated to a year sorts by that year; a
 * row dated to a century sorts by the century's first year, which is the
 * earliest that row could mean. Anything else has no year to sort by at all.
 */
function sortYear(pub) {
  const raw = String(pub.dateValue ?? "");
  if (pub.datePrecision === "year" && /^\d{4}$/.test(raw)) return Number(raw);
  const century = pub.datePrecision === "century" ? raw.match(/^(\d{1,2})(?:st|nd|rd|th)? century$/i) : null;
  if (century) return (Number(century[1]) - 1) * 100;
  return null;
}

/** The two boxes a pin's name and date take when set with `anchor`, `dx` and `dy`. */
function writingBoxes(pin, { anchor, dx, dy }) {
  const side = anchor === "end" ? -1 : 1;
  const from = pin.x + side * dx;
  return [
    [pin.name, NAME_BOX],
    [pin.label, DATE_BOX],
  ].map(([text, font]) => {
    const to = from + side * text.length * font.size * font.em;
    return {
      left: Math.min(from, to),
      right: Math.max(from, to),
      top: pin.y + dy + font.top,
      bottom: pin.y + dy + font.bottom,
    };
  });
}

function overlaps(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function markBox({ x, y, r }) {
  return { left: x - r, right: x + r, top: y - r, bottom: y + r };
}

/**
 * Where a pin's writing goes, or null when it cannot be written anywhere clean.
 * Two labels laid over each other, or a label laid over a named pin, read as
 * one tangle (site audit 13 Sep 2026, D21), so a pin whose name and date cannot
 * stand clear of every named pin's mark, inside the frame and off every other
 * pin's writing is not named at all, and the next oldest pub is asked instead.
 * A plain pub dot MAY sit under the writing: .lpMapPinName and .lpMapPinLabel
 * paint a halo in the land's own --panel-raised that keeps the letters legible
 * over it, and keeping clear of every dot would leave the City with no name at
 * all.
 */
function seat(pin, held) {
  // A label runs AWAY from the pin it shares a line of text with, and out
  // towards the nearer edge when it shares one with nobody. Pins are seated
  // oldest first, so a lone pin that ran in towards the centre laid its writing
  // across the City before any City pub was asked, and the face-away rule then
  // turned every one of them down. Only a pin on roughly the same line can
  // collide, so only those are asked.
  const sameLine = held.filter((other) => Math.abs(other.y - pin.y) <= LABEL_LINE_UNITS);
  const nearest = [...sameLine].sort((a, b) => Math.abs(a.x - pin.x) - Math.abs(b.x - pin.x))[0];
  const preferred = nearest ? (nearest.x <= pin.x ? "start" : "end") : pin.x > WIDTH / 2 ? "start" : "end";
  const anchors = preferred === "start" ? ["start", "end"] : ["end", "start"];
  const ownMark = markBox({ ...pin, r: PIN_MARK_RADIUS });
  if (held.some((other) => writingBoxes(other, other).some((theirs) => overlaps(ownMark, theirs)))) {
    return null;
  }
  const pinMarks = [...held, pin].map((other) => markBox({ ...other, r: PIN_MARK_RADIUS }));
  const options = PLACEMENTS.flatMap((placement) =>
    anchors.map((anchor) => ({ anchor, ...placement })),
  );
  return (
    options.find((option) => {
      const facesAway = sameLine.every((other) =>
        other.x <= pin.x
          ? other.anchor === "end" && option.anchor === "start"
          : other.anchor === "start" && option.anchor === "end",
      );
      if (!facesAway) return false;
      return writingBoxes(pin, option).every(
        (box) =>
          box.left >= FRAME_INSET &&
          box.right <= WIDTH - FRAME_INSET &&
          box.top >= FRAME_INSET &&
          box.bottom <= HEIGHT - FRAME_INSET &&
          !pinMarks.some((mark) => overlaps(box, mark)) &&
          !held.some((other) => writingBoxes(other, other).some((theirs) => overlaps(box, theirs))),
      );
    }) ?? null
  );
}

function namedPins(pubs) {
  const dated = pubs
    .filter(
      (pub) =>
        pub.sourced === true &&
        sortYear(pub) !== null &&
        typeof pub.dateLabel === "string" &&
        typeof pub.slug === "string" &&
        insideFrame(pub),
    )
    .sort((a, b) => sortYear(a) - sortYear(b));
  const picked = [];
  for (const pub of dated) {
    const pin = {
      slug: pub.slug,
      name: pub.name,
      label: pub.dateLabel,
      x: Math.round(projectX(pub.lng)),
      y: Math.round(projectY(pub.lat)),
    };
    const crowded = picked.some(
      (held) => Math.hypot(pin.x - held.x, pin.y - held.y) < PIN_SEPARATION_UNITS,
    );
    if (crowded) continue;
    const placement = seat(pin, picked);
    if (!placement) continue;
    picked.push({ ...pin, ...placement });
    if (picked.length === PIN_COUNT) break;
  }
  return picked;
}

const boroughs = JSON.parse(readFileSync(BOROUGHS, "utf8"));
const pubs = JSON.parse(readFileSync(HISTORIC, "utf8"));

const outlines = boroughPath(boroughs.features);
const inFrame = pubs.filter(insideFrame);
const dots = inFrame.map((pub) => [Math.round(projectX(pub.lng)), Math.round(projectY(pub.lat))]);
const pins = namedPins(pubs);
const pinned = new Set(pins.map((pin) => `${pin.x},${pin.y}`));
// A named pin draws its own mark, so the dot under it would double the ink.
const plainDots = dots.filter(([x, y]) => !pinned.has(`${x},${y}`));
// One subpath per dot, two arcs each, in one `d`.
const r = DOT_RADIUS;
const dotsPath = plainDots
  .map(([x, y]) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`)
  .join("");

const source = `// GENERATED by scripts/landing/build-landing-map.mjs. Do not edit by hand.
//
// The landing's drawing of London: the borough outlines, one dot for every
// historic pub inside the frame, and the six named pins the script's rule
// picked. Every figure here came from data/london_boroughs_simplified.json and
// public/data/historic_pubs.json. Re-run the script after either changes.

/** The drawing's own coordinate space. */
export const LONDON_MAP_VIEWBOX = "0 0 ${WIDTH} ${HEIGHT}";

/** The 33 London boroughs, outer rings only, clipped to the frame. */
export const LONDON_MAP_OUTLINES =
  ${JSON.stringify(outlines)};

/** One point per historic pub in the frame, without the six the pins name. */
/**
 * Every pub dot as ONE path rather than one element each. 293 <use> elements
 * cost 293 layout objects on a phone the landing is trying to paint in under a
 * second; one path is one.
 */
export const LONDON_MAP_PUB_DOTS =
  ${JSON.stringify(dotsPath)};

/** How many dots that path draws, so a test can count them. */
export const LONDON_MAP_PUB_DOT_COUNT = ${plainDots.length};

/** How many historic pubs the drawing shows, pins included. */
export const LONDON_MAP_PUB_COUNT = ${inFrame.length};

export type LondonMapPin = {
  slug: string;
  name: string;
  /** The heritage row's own words, such as "Founded 1520". */
  label: string;
  x: number;
  y: number;
  anchor: "start" | "end";
  /** How far along the line from the pin the writing starts. */
  dx: number;
  /** How far up (negative) or down the two lines of writing move. */
  dy: number;
};

/** The named pins: sourced, dated, oldest first, apart, and written clear of every named pin. */
export const LONDON_MAP_PINS: readonly LondonMapPin[] = ${JSON.stringify(pins, null, 2)};
`;

writeFileSync(OUT, source);
const kb = (Buffer.byteLength(source, "utf8") / 1024).toFixed(1);
console.log(
  `Wrote ${path.relative(ROOT, OUT)}: ${WIDTH}x${HEIGHT}, ${plainDots.length} dots, ${pins.length} pins, ${kb} KB.`,
);
for (const pin of pins) console.log(`  ${pin.name} (${pin.label})`);
