import { describe, expect, it } from "vitest";

import { palHeadTarget, palMouthOpenness } from "@/components/pal/usePalHead3D";
import { createPalVoiceSignal, palOutputLevel } from "@/lib/palVoiceSignal";

const still = { t: 0, pointerX: 0, pointerY: 0, heard: 0, spoken: 0 } as const;

describe("the voice signal", () => {
  it("reads silence with no live session", () => {
    expect(createPalVoiceSignal().read()).toEqual({ mode: "idle", input: 0, output: 0 });
  });

  it("reads the live levels, clamped to 0..1, and goes silent when detached", () => {
    const signal = createPalVoiceSignal();
    signal.attach({
      mode: "speaking",
      getInputVolume: () => 3,
      getOutputByteFrequencyData: () => new Uint8Array([255, 255, 255, 0, 0, 0]),
    });
    expect(signal.read()).toEqual({ mode: "speaking", input: 1, output: 1 });
    signal.attach(null);
    expect(signal.read().mode).toBe("idle");
  });

  it("reads a session that throws between frames as silence", () => {
    const signal = createPalVoiceSignal();
    signal.attach({
      mode: "listening",
      getInputVolume: () => { throw new Error("gone"); },
      getOutputByteFrequencyData: () => new Uint8Array(0),
    });
    expect(signal.read()).toEqual({ mode: "idle", input: 0, output: 0 });
  });

  it("measures the Pal's voice from the low third of its spectrum", () => {
    expect(palOutputLevel(new Uint8Array(0))).toBe(0);
    expect(palOutputLevel(new Uint8Array([102, 102, 102, 255, 255, 255, 255, 255, 255]))).toBeCloseTo(0.4);
  });
});

describe("the head's pose", () => {
  it("turns towards the pointer", () => {
    const right = palHeadTarget({ ...still, pointerX: 1, mode: "idle", state: "idle" });
    const left = palHeadTarget({ ...still, pointerX: -1, mode: "idle", state: "idle" });
    expect(right.yaw).toBeGreaterThan(10);
    expect(left.yaw).toBeLessThan(-10);
  });

  it("leans in further the louder the person speaks", () => {
    const quiet = palHeadTarget({ ...still, mode: "listening", state: "listening", heard: 0 });
    const loud = palHeadTarget({ ...still, mode: "listening", state: "listening", heard: 1 });
    expect(quiet.lean).toBeGreaterThan(0);
    expect(loud.lean).toBeGreaterThan(quiet.lean);
  });

  it("lifts and grows on the Pal's own words, and rests when it is silent", () => {
    const talking = palHeadTarget({ ...still, mode: "speaking", state: "speaking", spoken: 1 });
    const silent = palHeadTarget({ ...still, mode: "speaking", state: "speaking", spoken: 0 });
    expect(talking.lift).toBeGreaterThan(10);
    expect(talking.scale).toBeGreaterThan(1);
    expect(silent.lift).toBe(0);
    expect(silent.scale).toBe(1);
  });

  it("tips its head and looks up while thinking", () => {
    const thinking = palHeadTarget({ ...still, mode: "idle", state: "thinking" });
    expect(thinking.roll).toBeGreaterThan(0);
    expect(thinking.pitch).toBeLessThan(0);
  });

  it("lifts its head and stretches out of the sleeping droop when it wakes", () => {
    const sleeping = palHeadTarget({ ...still, mode: "idle", state: "sleeping" });
    const waking = palHeadTarget({ ...still, mode: "idle", state: "waking" });
    expect(sleeping.pitch).toBeGreaterThan(0);
    expect(waking.pitch).toBeLessThan(0);
    expect(waking.lift).toBeGreaterThan(0);
    expect(waking.scale).toBeGreaterThan(1);
  });
});

describe("palMouthOpenness", () => {
  it("keeps the mouth shut in silence and under the floor", () => {
    expect(palMouthOpenness(0)).toBe(0);
    expect(palMouthOpenness(0.05)).toBe(0);
    expect(palMouthOpenness(Number.NaN)).toBe(0);
    expect(palMouthOpenness(-1)).toBe(0);
  });

  it("opens with the Pal's own voice and never past fully open", () => {
    expect(palMouthOpenness(0.2)).toBeGreaterThan(0.3);
    expect(palMouthOpenness(0.3)).toBeGreaterThan(palMouthOpenness(0.2));
    expect(palMouthOpenness(1)).toBe(1);
  });
});

