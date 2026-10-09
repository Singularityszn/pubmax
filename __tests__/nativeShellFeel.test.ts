import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HAPTIC_OCCASIONS,
  hapticEngineFor,
  playHaptic,
  prefersReducedMotion,
  shouldPlayHaptic,
} from "@/lib/nativeHaptics";

type AnyGlobal = { window?: unknown };
const g = globalThis as AnyGlobal;

function stubShell({
  native,
  reducedMotion = false,
}: {
  native: boolean;
  reducedMotion?: boolean;
}): void {
  g.window = {
    Capacitor: { isNativePlatform: () => native, getPlatform: () => "ios" },
    matchMedia: (query: string) => ({
      matches: query.includes("reduce") ? reducedMotion : false,
    }),
  };
}

afterEach(() => {
  delete g.window;
  vi.restoreAllMocks();
});

describe("the haptic vocabulary", () => {
  it("names an occasion, never an intensity", () => {
    // Two surfaces that mean the same thing cannot land on different engines,
    // because a surface picks a word out of this closed set and the table
    // picks the engine.
    expect(HAPTIC_OCCASIONS).toEqual([
      "contribution-kept",
      "selection-kept",
      "selection-released",
      "action-refused",
      "plan-locked",
    ]);
  });

  it("gives every occasion an engine, so nothing falls through silently", () => {
    for (const occasion of HAPTIC_OCCASIONS) {
      const engine = hapticEngineFor(occasion);
      expect(engine, occasion).toBeTruthy();
      expect(["impact", "notification"], occasion).toContain(engine.kind);
    }
  });

  it("reserves the two-beat notification for a kept contribution, a locked plan and a refusal", () => {
    // A Pint Drop is the action the product is built around, a locked plan is
    // the moment a route becomes real; a refusal is the only other thing worth
    // interrupting a thumb for.
    expect(hapticEngineFor("contribution-kept")).toEqual({
      kind: "notification",
      style: "Success",
    });
    expect(hapticEngineFor("action-refused")).toEqual({
      kind: "notification",
      style: "Warning",
    });
    expect(hapticEngineFor("plan-locked")).toEqual({
      kind: "notification",
      style: "Success",
    });
    expect(hapticEngineFor("selection-kept").kind).toBe("impact");
    expect(hapticEngineFor("selection-released").kind).toBe("impact");
  });

  it("releases lighter than it keeps", () => {
    const kept = hapticEngineFor("selection-kept");
    const released = hapticEngineFor("selection-released");
    expect(kept).toEqual({ kind: "impact", style: "Medium" });
    expect(released).toEqual({ kind: "impact", style: "Light" });
  });
});

describe("the haptic gate", () => {
  it("never buzzes on the web or during a server render", () => {
    expect(shouldPlayHaptic({ isNative: false, reducedMotion: false })).toBe(false);
    // No window at all.
    expect(prefersReducedMotion()).toBe(false);
  });

  it("never buzzes when the device asked for reduced motion", () => {
    // iOS routes vestibular sensitivity through this setting, so a person who
    // set it has asked for this too.
    expect(shouldPlayHaptic({ isNative: true, reducedMotion: true })).toBe(false);
  });

  it("buzzes only inside the shell with motion allowed", () => {
    expect(shouldPlayHaptic({ isNative: true, reducedMotion: false })).toBe(true);
  });

  it("reads reduced motion off the live media query", () => {
    stubShell({ native: true, reducedMotion: true });
    expect(prefersReducedMotion()).toBe(true);
    stubShell({ native: true, reducedMotion: false });
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("playHaptic never gates the action it accompanies", () => {
  it("resolves false on the web rather than rejecting", async () => {
    stubShell({ native: false });
    await expect(playHaptic("contribution-kept")).resolves.toBe(false);
  });

  it("resolves false under reduced motion rather than rejecting", async () => {
    stubShell({ native: true, reducedMotion: true });
    await expect(playHaptic("selection-kept")).resolves.toBe(false);
  });

  it("resolves false rather than rejecting when the plugin is unavailable", async () => {
    // Inside the shell with motion allowed, so the gate opens and the dynamic
    // import runs. There is no native vibrator behind it in node, and the
    // receipt this sits beside must still print.
    stubShell({ native: true });
    await expect(playHaptic("contribution-kept")).resolves.toBe(false);
  });
});
