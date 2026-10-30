// The Pal stage moves the real artwork by a rig per species. These pin the
// rig to the art it moves: the mouth where the talking frame was cut, every
// shape on the 512 square, no more shapes than the shader holds, and a loop
// whose last frame meets its first.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PAL_MASCOT_SLUGS, palMascotSpeciesList } from "@/lib/palMascotAssets.mjs";
import {
  PAL_STAGE_MAX_BUMPS,
  PAL_STAGE_RIGS,
  palStageBlink,
  palStageImages,
  palStageLiveFrame,
  palStagePose,
  palStageSpeciesForSlug,
  type PalStageEllipse,
} from "@/lib/palStageRig";

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

  it.each(palMascotSpeciesList())("%s draws only committed art, for the render and for the page", (species) => {
    for (const format of ["png", "webp"] as const) {
      const { master, talk } = palStageImages(species, format);
      expect(existsSync(join(ROOT, "public", master))).toBe(true);
      expect(existsSync(join(ROOT, "public", talk))).toBe(true);
    }
  });

  it.each(palMascotSpeciesList())("%s is found again from its mascot slug", (species) => {
    expect(palStageSpeciesForSlug(PAL_MASCOT_SLUGS[species])).toBe(species);
  });

  it("finds no rig for a legacy icon species or an unknown slug", () => {
    expect(palStageSpeciesForSlug(null)).toBeNull();
    expect(palStageSpeciesForSlug("circuit-dragon")).toBeNull();
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
    end.turn.forEach((value: number, axis: number) => expect(value).toBeCloseTo(start.turn[axis] ?? 0, 6));
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

describe("palStageBlink", () => {
  it("keeps the eyes open most of the time and shuts them fully in each blink", () => {
    const samples = Array.from({ length: 2560 }, (_, i) => palStageBlink(i / 100));
    expect(samples.filter((value) => value === 0).length / samples.length).toBeGreaterThan(0.9);
    expect(samples.some((value) => value === 1)).toBe(true);
    for (const value of samples) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("varies the gap between blinks", () => {
    const starts: number[] = [];
    let open = true;
    for (let i = 0; i < 2560; i += 1) {
      const shut = palStageBlink(i / 100) > 0;
      if (shut && open) starts.push(i / 100);
      open = !shut;
    }
    const gaps = starts.slice(1).map((start, i) => Math.round((start - (starts[i] ?? 0)) * 10));
    expect(new Set(gaps).size).toBeGreaterThan(2);
  });

  it("stays open for a time it cannot read", () => {
    expect(palStageBlink(Number.NaN)).toBe(0);
    expect(palStageBlink(-1)).toBe(0);
  });
});

describe("palStageLiveFrame", () => {
  it("turns the art the way the head loop turns the portrait", () => {
    const rest = palStageLiveFrame({ seconds: 1, yaw: 0, pitch: 0, roll: 0, mouth: 0 });
    const right = palStageLiveFrame({ seconds: 1, yaw: 16, pitch: 0, roll: 0, mouth: 0 });
    expect(rest.turn[0]).toBe(0);
    expect(right.turn[0]).toBeGreaterThan(10);
    expect(right.turn[0]).toBeLessThan(15);
    expect(right.cam[0]).toBeGreaterThan(0);
    expect(palStageLiveFrame({ seconds: 1, yaw: 0, pitch: 0, roll: 90, mouth: 0 }).turn[2]).toBeCloseTo(Math.PI / 2, 6);
  });

  it("passes the mouth through, held between shut and wide", () => {
    expect(palStageLiveFrame({ seconds: 0, yaw: 0, pitch: 0, roll: 0, mouth: 0.4 }).mouth).toBe(0.4);
    expect(palStageLiveFrame({ seconds: 0, yaw: 0, pitch: 0, roll: 0, mouth: 3 }).mouth).toBe(1);
    expect(palStageLiveFrame({ seconds: 0, yaw: 0, pitch: 0, roll: 0, mouth: -1 }).mouth).toBe(0);
  });

  it("holds still on a pose it cannot read", () => {
    const frame = palStageLiveFrame({ seconds: 0, yaw: Number.NaN, pitch: Infinity, roll: Number.NaN, mouth: Number.NaN });
    expect([...frame.cam, ...frame.turn, frame.mouth].every((value) => value === 0)).toBe(true);
  });
});
