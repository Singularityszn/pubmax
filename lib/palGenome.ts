// The Pal genome: what makes two foxes two different foxes.
//
// Every Pal of a species is the same rendered master photograph ("Every Pub
// Pal is a rendered master", docs/rules/components-design-system-and-launch-
// primitives.md), so the genome never draws the animal and never recolours
// it. It decides how that photograph is HELD and how it MOVES:
// - which way the Pal faces, how close it is framed and where, and the angle
//   it rests its head at;
// - where the light catches it;
// - its temperament in the 3D head: how fast it sways, how far it nods, how
//   keenly it perks up and leans in, tuned by the personality the person set;
// - a Pal print, a five-by-five mirrored mark no other Pal shares.
//
// The seed is the Pal's own id, so the genome is the same on every device and
// every visit, needs no column and no migration, and a new Pal is a new
// genome. The person's chosen personality shapes the temperament on top.

import type { PubPalPersonality } from "@/lib/pubPal";

export type PalTemperament = {
  /** Sway speed multiplier. */
  pace: number;
  /** Sway size multiplier. */
  sway: number;
  /** Nod size multiplier while it speaks. */
  nod: number;
  /** How keenly it perks up and leans in while it listens. */
  keen: number;
};

export type PalGenome = {
  /** 1 faces as photographed, -1 faces the other way. */
  flip: 1 | -1;
  /**
   * How close the photograph is framed, 1.08 to 1.18. Never under 1.08, so the
   * overhang on each side (4 per cent) always covers the largest framing shift
   * and the frame never shows an edge of the photograph.
   */
  zoom: number;
  /** Where the framing sits, in per cent of the frame, -4 to 4 each way. */
  focusX: number;
  focusY: number;
  /** The angle it rests its head at, in degrees, -5 to 5. */
  tilt: number;
  /** Where the light catches it, in per cent across and down. */
  sheenX: number;
  sheenY: number;
  temperament: PalTemperament;
  /** 25 cells, row by row, mirrored left to right. */
  print: boolean[];
};

export const PAL_PRINT_SIZE = 5;

/** A 32-bit string hash (cyrb53's mixing, folded to 32 bits). */
function hashSeed(seed: string): number {
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** mulberry32: a small, well-mixed generator, deterministic for a seed. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random: () => number, low: number, high: number): number {
  return low + random() * (high - low);
}

function round(value: number, places = 3): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/** A personality trait, 0 to 100, as a multiplier around 1. */
function lean(trait: number | undefined, spread: number): number {
  const unit = Math.min(100, Math.max(0, trait ?? 50)) / 100;
  return 1 + (unit - 0.5) * 2 * spread;
}

function palPrint(random: () => number): boolean[] {
  const half = Math.ceil(PAL_PRINT_SIZE / 2);
  const cells: boolean[] = [];
  for (let row = 0; row < PAL_PRINT_SIZE; row += 1) {
    const left: boolean[] = [];
    for (let column = 0; column < half; column += 1) left.push(random() < 0.5);
    const mirrored = [...left.slice(0, PAL_PRINT_SIZE - half)].reverse();
    cells.push(...left, ...mirrored);
  }
  // A print with nothing in it is no print: light the centre.
  if (!cells.some(Boolean)) cells[Math.floor(cells.length / 2)] = true;
  return cells;
}

export function palGenomeFor(seed: string, personality?: Partial<PubPalPersonality>): PalGenome {
  const random = generator(hashSeed(`pal-genome:${seed}`));
  const flip = random() < 0.5 ? 1 : -1;
  const zoom = round(between(random, 1.08, 1.18));
  const focusX = round(between(random, -4, 4), 2);
  const focusY = round(between(random, -4, 4), 2);
  const tilt = round(between(random, -5, 5), 2);
  const sheenX = round(between(random, 30, 70), 1);
  const sheenY = round(between(random, 18, 42), 1);
  const temperament: PalTemperament = {
    pace: round(between(random, 0.75, 1.3) * lean(personality?.energy, 0.25)),
    sway: round(between(random, 0.6, 1.4) * lean(personality?.playfulness, 0.3)),
    nod: round(between(random, 0.7, 1.35) * lean(personality?.storytelling, 0.2)),
    keen: round(between(random, 0.7, 1.3) * lean(personality?.energy, 0.2)),
  };
  return { flip, zoom, focusX, focusY, tilt, sheenX, sheenY, temperament, print: palPrint(random) };
}

/** The genome as the CSS custom properties app/pal/pal.css reads. */
export function palGenomeStyle(genome: PalGenome): Record<`--${string}`, string> {
  return {
    "--genome-flip": String(genome.flip),
    "--genome-zoom": String(genome.zoom),
    "--genome-x": `${genome.focusX}%`,
    "--genome-y": `${genome.focusY}%`,
    "--genome-tilt": `${genome.tilt}deg`,
    "--genome-sheen-x": `${genome.sheenX}%`,
    "--genome-sheen-y": `${genome.sheenY}%`,
  };
}
