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
//     historic pub with a year we can print, oldest first, one per borough, six
//     of them. Re-run the script after the heritage data changes and the pins
//     follow the data rather than somebody's taste.
//
// (3) IT SHIPS AS GEOMETRY, NOT AS AN IMAGE FILE. The output is a TypeScript
//     module of path data that components/landing/LondonMapSnapshot.tsx paints
//     inline, so the drawing takes the reader's own theme tokens, costs no
//     request at all, and is sharp at every width. The size ceiling lives in
//     __tests__/landingMapSnapshot.test.ts.
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
 * The CAP on named pins. The separation rule below decides how many of them
 * the data can actually seat, and today that is five: past this the labels
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
const SIMPLIFY_UNITS = 5;

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
    const x = projectX(pub.lng);
    const y = projectY(pub.lat);
    const crowded = picked.some(
      (held) =>
        Math.hypot(x - projectX(held.lng), y - projectY(held.lat)) < PIN_SEPARATION_UNITS,
    );
    if (crowded) continue;
    picked.push(pub);
    if (picked.length === PIN_COUNT) break;
  }
  const placed = picked.map((pub) => ({
    slug: pub.slug,
    name: pub.name,
    label: pub.dateLabel,
    x: Math.round(projectX(pub.lng)),
    y: Math.round(projectY(pub.lat)),
  }));
  return placed.map((pin) => {
    // A label runs AWAY from the pin it shares a line of text with, and away
    // from the nearer edge when it shares one with nobody. Anchoring on the
    // frame's centre alone pointed two labels straight at each other across the
    // City; only a pin on roughly the same line can collide, so only those are
    // asked.
    const sameLine = placed.filter(
      (other) => other !== pin && Math.abs(other.y - pin.y) <= LABEL_LINE_UNITS,
    );
    const nearest = sameLine.sort(
      (a, b) => Math.abs(a.x - pin.x) - Math.abs(b.x - pin.x),
    )[0];
    const anchor = nearest
      ? nearest.x <= pin.x
        ? "start"
        : "end"
      : pin.x > WIDTH / 2
        ? "end"
        : "start";
    return { ...pin, anchor };
  });
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
export const LONDON_MAP_PUB_POINTS: readonly (readonly [number, number])[] = [
${plainDots.map(([x, y]) => `  [${x}, ${y}],`).join("\n")}
];

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
};

/** The named pins: sourced, dated, oldest first, one per borough. */
export const LONDON_MAP_PINS: readonly LondonMapPin[] = ${JSON.stringify(pins, null, 2)};
`;

writeFileSync(OUT, source);
const kb = (Buffer.byteLength(source, "utf8") / 1024).toFixed(1);
console.log(
  `Wrote ${path.relative(ROOT, OUT)}: ${WIDTH}x${HEIGHT}, ${plainDots.length} dots, ${pins.length} pins, ${kb} KB.`,
);
for (const pin of pins) console.log(`  ${pin.name} (${pin.label})`);
