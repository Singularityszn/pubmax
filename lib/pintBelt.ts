/**
 * The pint belt's geometry and pace (app/tonight/TonightPintBelt.tsx): beer
 * mats riding a stadium-shaped loop, the way plates ride a sushi bar's belt.
 * Pure, so the track and the clock can be tested without a browser.
 */

import { londonMsSinceMidnight } from "@/lib/londonHour";

export type BeltTrack = {
  /** The belt's box, in px. */
  width: number;
  height: number;
  /** A mat's diameter, in px. */
  mat: number;
};

type BeltShape = {
  radius: number;
  leftX: number;
  rightX: number;
  centreY: number;
  straight: number;
  perimeter: number;
};

function beltShape({ width, height, mat }: BeltTrack): BeltShape {
  const radius = Math.max(0, (height - mat) / 2);
  const leftX = mat / 2 + radius;
  const rightX = Math.max(leftX, width - mat / 2 - radius);
  const straight = rightX - leftX;
  return {
    radius,
    leftX,
    rightX,
    centreY: height / 2,
    straight,
    perimeter: 2 * straight + 2 * Math.PI * radius,
  };
}

/** One lap of the loop's centre line, in px. */
export function beltPerimeter(track: BeltTrack): number {
  return beltShape(track).perimeter;
}

/**
 * The centre of a mat at `progress` round the loop (0 to 1, wrapping),
 * clockwise from the left end of the top straight.
 */
export function beltPoint(track: BeltTrack, progress: number): { x: number; y: number } {
  const { radius, leftX, rightX, centreY, straight, perimeter } = beltShape(track);
  if (perimeter <= 0) return { x: track.width / 2, y: centreY };
  const wrapped = ((progress % 1) + 1) % 1;
  let distance = wrapped * perimeter;
  if (distance < straight) return { x: leftX + distance, y: centreY - radius };
  distance -= straight;
  const arc = Math.PI * radius;
  if (distance < arc) {
    const angle = distance / Math.max(radius, 1e-6) - Math.PI / 2;
    return { x: rightX + radius * Math.cos(angle), y: centreY + radius * Math.sin(angle) };
  }
  distance -= arc;
  if (distance < straight) return { x: rightX - distance, y: centreY + radius };
  distance -= straight;
  const angle = distance / Math.max(radius, 1e-6) + Math.PI / 2;
  return { x: leftX + radius * Math.cos(angle), y: centreY + radius * Math.sin(angle) };
}

/** The SVG path of the loop's centre line, for the belt the mats ride on. */
export function beltPath(track: BeltTrack): string {
  const { radius, leftX, rightX, centreY } = beltShape(track);
  const top = centreY - radius;
  const bottom = centreY + radius;
  return [
    `M ${leftX} ${top}`,
    `H ${rightX}`,
    `A ${radius} ${radius} 0 0 1 ${rightX} ${bottom}`,
    `H ${leftX}`,
    `A ${radius} ${radius} 0 0 1 ${leftX} ${top}`,
    "Z",
  ].join(" ");
}

/** One lap at an ordinary pace. Slow enough to read a mat as it passes. */
const BASE_LAP_MS = 48_000;
const EARLY = 17 * 60;
const LATE = 23 * 60;
const SLOWEST = 0.6;
const FASTEST = 1.4;

/**
 * How fast the belt runs against the London clock: an easy pace in the
 * afternoon, picking up through the evening and running hottest from 23:00,
 * when last orders is close, until the small hours. Times 0.6 to 1.4.
 */
export function beltPace(now: Date): number {
  const minutes = londonMsSinceMidnight(now) / 60_000;
  if (minutes < 4 * 60) return FASTEST;
  if (minutes <= EARLY) return SLOWEST;
  if (minutes >= LATE) return FASTEST;
  return SLOWEST + ((minutes - EARLY) / (LATE - EARLY)) * (FASTEST - SLOWEST);
}

/** One lap's length in milliseconds at this hour's pace. */
export function beltLapMs(now: Date): number {
  return BASE_LAP_MS / beltPace(now);
}
