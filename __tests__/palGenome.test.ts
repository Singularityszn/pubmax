import { describe, expect, it } from "vitest";

import { palHeadTarget } from "@/components/pal/usePalHead3D";
import { PAL_PRINT_SIZE, palGenomeFor, palGenomeStyle } from "@/lib/palGenome";

const ids = Array.from({ length: 200 }, (_, index) =>
  `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`,
);

describe("the Pal genome", () => {
  it("is the same genome for the same Pal, every time", () => {
    expect(palGenomeFor(ids[0]!)).toEqual(palGenomeFor(ids[0]!));
  });

  it("keeps every trait inside its range, so the photograph never shows an edge", () => {
    for (const id of ids) {
      const genome = palGenomeFor(id);
      expect([1, -1]).toContain(genome.flip);
      expect(genome.zoom).toBeGreaterThanOrEqual(1.08);
      expect(genome.zoom).toBeLessThanOrEqual(1.18);
      // The overhang each side of the zoomed photograph covers the shift.
      const overhang = ((genome.zoom - 1) / 2) * 100;
      expect(Math.abs(genome.focusX)).toBeLessThanOrEqual(overhang + 1e-9);
      expect(Math.abs(genome.focusY)).toBeLessThanOrEqual(overhang + 1e-9);
      expect(Math.abs(genome.tilt)).toBeLessThanOrEqual(5);
    }
  });

  it("gives different Pals different genomes and different prints", () => {
    const prints = new Set(ids.map((id) => palGenomeFor(id).print.map(Number).join("")));
    const poses = new Set(ids.map((id) => {
      const genome = palGenomeFor(id);
      return `${genome.flip}:${genome.zoom}:${genome.focusX}:${genome.tilt}`;
    }));
    expect(prints.size).toBeGreaterThan(190);
    expect(poses.size).toBe(ids.length);
    // Both facings turn up.
    expect(new Set(ids.map((id) => palGenomeFor(id).flip)).size).toBe(2);
  });

  it("draws a print mirrored left to right, like a face, and never an empty one", () => {
    for (const id of ids) {
      const { print } = palGenomeFor(id);
      expect(print).toHaveLength(PAL_PRINT_SIZE * PAL_PRINT_SIZE);
      expect(print.some(Boolean)).toBe(true);
      for (let row = 0; row < PAL_PRINT_SIZE; row += 1) {
        const cells = print.slice(row * PAL_PRINT_SIZE, (row + 1) * PAL_PRINT_SIZE);
        expect(cells).toEqual([...cells].reverse());
      }
    }
  });

  it("lets the personality the person chose shape the temperament", () => {
    const calm = palGenomeFor(ids[3]!, { energy: 0, playfulness: 0, storytelling: 0 });
    const lively = palGenomeFor(ids[3]!, { energy: 100, playfulness: 100, storytelling: 100 });
    expect(lively.temperament.pace).toBeGreaterThan(calm.temperament.pace);
    expect(lively.temperament.sway).toBeGreaterThan(calm.temperament.sway);
    expect(lively.temperament.nod).toBeGreaterThan(calm.temperament.nod);
    // The framing is the Pal's own and does not move with the personality.
    expect(lively.flip).toBe(calm.flip);
    expect(lively.zoom).toBe(calm.zoom);
  });

  it("writes the framing as the CSS properties the stylesheet reads", () => {
    const style = palGenomeStyle(palGenomeFor(ids[1]!));
    expect(Object.keys(style).sort()).toEqual([
      "--genome-flip", "--genome-sheen-x", "--genome-sheen-y", "--genome-tilt",
      "--genome-x", "--genome-y", "--genome-zoom",
    ]);
  });
});

describe("the temperament in the 3D head", () => {
  it("sways a lively Pal further than a calm one", () => {
    const at = { t: 3.1, pointerX: 0, pointerY: 0, mode: "idle", state: "idle", heard: 0, spoken: 0 } as const;
    const calm = palHeadTarget({ ...at, temperament: { pace: 1, sway: 0.5, nod: 1, keen: 1 } });
    const lively = palHeadTarget({ ...at, temperament: { pace: 1, sway: 1.5, nod: 1, keen: 1 } });
    expect(Math.abs(lively.yaw)).toBeGreaterThan(Math.abs(calm.yaw));
  });

  it("leans a keen Pal further in on the same voice", () => {
    const at = { t: 0, pointerX: 0, pointerY: 0, mode: "listening", state: "listening", heard: 0.5, spoken: 0 } as const;
    const shy = palHeadTarget({ ...at, temperament: { pace: 1, sway: 1, nod: 1, keen: 0.7 } });
    const keen = palHeadTarget({ ...at, temperament: { pace: 1, sway: 1, nod: 1, keen: 1.3 } });
    expect(keen.lean).toBeGreaterThan(shy.lean);
  });
});
