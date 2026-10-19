import type { PubPalSpecies } from "@/lib/pubPal";

type Vec3 = readonly [number, number, number];
export type PalModelPart = { centre: Vec3; scale: Vec3; colour: Vec3; glow: number; eye?: boolean };
const CHARCOAL: Vec3 = [0.008, 0.011, 0.014];
const CORAL: Vec3 = [0.8, 0.04, 0.035];
const CYAN: Vec3 = [0.025, 0.65, 0.8];
const AMBER: Vec3 = [0.8, 0.3, 0.025];

/** Rounded volumes in the Circuit Robin family. All geometry is local. */
export function palModelParts(species: PubPalSpecies): PalModelPart[] {
  const parts: PalModelPart[] = [];
  const add = (centre: Vec3, scale: Vec3, colour = CHARCOAL, glow = 0) => {
    const part: PalModelPart = { centre, scale, colour, glow };
    parts.push(part);
    return part;
  };
  const bird = species === "robin" || species === "pigeon";
  const dog = species === "greyhound" || species === "hound" || species === "corgi";
  add([0, -0.35, 0], [0.73, 0.85, 0.61]);
  add([0, 0.63, 0.06], [0.8, 0.76, 0.7]);
  add([0, -0.33, 0.55], [0.53, 0.57, 0.15], CORAL, 0.25);
  for (const side of [-1, 1]) {
    add([side * 0.75, -0.32, -0.02], [0.23, 0.62, 0.38]);
    add([side * 0.31, -1.14, 0.2], [0.25, 0.14, 0.34], bird ? AMBER : CHARCOAL);
    add([side * 0.31, 0.76, 0.7], [0.19, 0.2, 0.09], [0.025, 0.03, 0.04]);
    add([side * 0.31, 0.76, 0.775], [0.115, 0.125, 0.045], CYAN, 0.8).eye = true;
    add([side * 0.34 - 0.028, 0.8, 0.815], [0.027, 0.032, 0.015], [0.84, 1, 1], 1).eye = true;
    add([side * 0.48, 0.47, 0.665], [0.1, 0.05, 0.025], [0.5, 0.13, 0.14]);
    // One restrained trace on each wing or ear, with a rounded terminal.
    const traceY = bird ? -0.17 : 1.35;
    const traceX = bird ? 0.83 : 0.52;
    add([side * traceX, traceY, bird ? 0.25 : 0.12], [0.018, 0.14, 0.018], AMBER, 0.5);
    add([side * traceX, traceY + 0.14, bird ? 0.25 : 0.12], [0.035, 0.035, 0.025], AMBER, 0.5);
    if (!bird) {
      const longEar = species === "cat" || species === "fox" || species === "corgi";
      add([side * 0.52, longEar ? 1.28 : 0.99, -0.02], [longEar ? 0.25 : 0.24, longEar ? 0.44 : 0.25, 0.22]);
      if (species === "badger") add([side * 0.35, 0.82, 0.63], [0.11, 0.43, 0.065], [0.7, 0.72, 0.68]);
    }
  }
  add([0, bird ? 0.47 : 0.42, bird ? 0.79 : 0.7], bird ? [0.12, 0.1, 0.19] : [dog ? 0.28 : 0.2, 0.16, dog ? 0.28 : 0.16], bird ? AMBER : CHARCOAL);
  if (!bird) add([0, 0.47, dog ? 0.96 : 0.85], [0.085, 0.06, 0.04], [0.02, 0.025, 0.03]);
  // The chest circuit is a sparse path of rounded bars.
  add([-0.12, -0.25, 0.704], [0.018, 0.17, 0.014], AMBER, 0.45);
  add([0.01, -0.4, 0.704], [0.14, 0.018, 0.014], AMBER, 0.45);
  add([0.14, -0.34, 0.704], [0.018, 0.08, 0.014], AMBER, 0.45);
  add([0.14, -0.26, 0.71], [0.04, 0.04, 0.02], AMBER, 0.6);
  return parts;
}

/** One reusable unit sphere, position and normal interleaved. */
export function palModelSphere(): Float32Array {
  const vertices: number[] = [];
  const point = (u: number, v: number) => {
    const x = Math.sin(v) * Math.cos(u), y = Math.cos(v), z = Math.sin(v) * Math.sin(u);
    vertices.push(x, y, z, x, y, z);
  };
  for (let row = 0; row < 16; row++) {
    for (let column = 0; column < 24; column++) {
      const u = column * Math.PI / 12, nextU = (column + 1) * Math.PI / 12;
      const v = row * Math.PI / 16, nextV = (row + 1) * Math.PI / 16;
      point(u, v); point(u, nextV); point(nextU, v);
      point(nextU, v); point(u, nextV); point(nextU, nextV);
    }
  }
  return new Float32Array(vertices);
}
