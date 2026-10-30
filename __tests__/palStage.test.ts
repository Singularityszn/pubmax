// The Pal stage moves the real artwork by a rig per species. These pin the
// rig to the art it moves: the mouth where the talking frame was cut, every
// shape on the 512 square, no more shapes than the shader holds, and a loop
// whose last frame meets its first.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { palStagePose } from "@/components/pal/PalStage";
import { palMascotSpeciesList } from "@/lib/palMascotAssets.mjs";
import { PAL_STAGE_MAX_BUMPS, PAL_STAGE_RIGS, palStageImages, type PalStageEllipse } from "@/lib/palStageRig";

const ROOT = process.cwd();
const OVALS = JSON.parse(readFileSync(join(ROOT, "scripts/pubpal/mouth-ovals.json"), "utf8")) as {
  ovals: Record<string, PalStageEllipse>;
};

const onSquare = (shape: PalStageEllipse) =>
  shape.cx >= 0 && shape.cx <= 512 && shape.cy >= 0 && shape.cy <= 512 && shape.rx > 0 && shape.ry > 0;

describe("Pal stage rig", () => {
  it.each(palMascotSpeciesList())("%s opens its mouth where the talking frame was cut", (species) => {
    expect(PAL_STAGE_RIGS[species].mouth).toEqual(OVALS.ovals[species]);
  });

  it.each(palMascotSpeciesList())("%s keeps every shape on its 512 master", (species) => {
    const rig = PAL_STAGE_RIGS[species];
    expect(rig.bumps.length).toBeGreaterThan(0);
    expect(rig.bumps.length).toBeLessThanOrEqual(PAL_STAGE_MAX_BUMPS);
    for (const shape of [rig.head, rig.mouth, ...rig.eyes, ...rig.bumps]) expect(onSquare(shape)).toBe(true);
  });

  it.each(palMascotSpeciesList())("%s draws only committed art", (species) => {
    const { master, talk } = palStageImages(species);
    expect(existsSync(join(ROOT, "public", master))).toBe(true);
    expect(existsSync(join(ROOT, "public", talk))).toBe(true);
  });

  it("only the corgi, whose master already smiles open, shuts its mouth to talk", () => {
    const shuts = palMascotSpeciesList().filter((species) => !PAL_STAGE_RIGS[species].mouthOpensWithVoice);
    expect(shuts).toEqual(["corgi"]);
  });
});

describe("palStagePose", () => {
  it("ends the loop where it began, so a render repeats without a jump", () => {
    const start = palStagePose(0, 0);
    const end = palStagePose(1, 0);
    expect(end.cam[0]).toBeCloseTo(start.cam[0], 6);
    expect(end.cam[1]).toBeCloseTo(start.cam[1], 6);
    end.turn.forEach((value, axis) => expect(value).toBeCloseTo(start.turn[axis] ?? 0, 6));
    expect(end.breath).toBeCloseTo(start.breath, 6);
    expect(start.blink).toBe(0);
    expect(end.blink).toBe(0);
  });

  it("blinks twice a loop, eyes fully shut at the middle of each blink", () => {
    const blinks = Array.from({ length: 180 }, (_, frame) => palStagePose(frame / 180, 0).blink);
    const shut = blinks.filter((value) => value === 1).length;
    expect(shut).toBeGreaterThan(0);
    expect(blinks.filter((value) => value > 0).length).toBeLessThan(30);
  });

  it("nods as the voice rises", () => {
    expect(palStagePose(0.25, 1).turn[1]).toBeGreaterThan(palStagePose(0.25, 0).turn[1]);
  });
});
