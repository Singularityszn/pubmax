import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

type Probe = {
  error: string | null;
  modules: { context: number; url: string }[];
  contexts: { sampleRate: number; closeCalls: number }[];
  trackStops: number[];
  audioElementsRemaining: number;
  socketCloseCalls: number;
  wakeReleases: number;
  webRtcControllersRetained: boolean | null;
  webRtcCreates: number;
};

function setupProbe(bundler: string, scenario: string): Probe {
  const child = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), "__tests__/fixtures/elevenlabs/output-resampler-probe.mjs"),
      bundler,
      scenario,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DEPLOYMENT_VERSION: "local" },
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout) as Probe;
}

describe.each(["turbopack", "webpack"])("%s ElevenLabs output setup", (bundler) => {
  it.each(["mismatched-rate", "unsupported-rate"])(
    "loads the same-origin output resampler with %s and releases the session resources",
    (scenario) => {
      const result = setupProbe(bundler, scenario);
      expect(result.error).toBeNull();
      expect(result.modules.filter((module) => module.context === 1)).toEqual([
        { context: 1, url: "/vendor/elevenlabs/libsamplerate.worklet.js" },
        { context: 1, url: "/vendor/elevenlabs/audio-concat-processor.js" },
      ]);
      expect(result.modules.every((module) => module.url.startsWith("/vendor/elevenlabs/"))).toBe(true);
      expect(result.contexts.map((context) => context.closeCalls)).toEqual([1, 1]);
      expect(result.trackStops).toEqual([1, 1]);
      expect(result.audioElementsRemaining).toBe(0);
      expect(result.socketCloseCalls).toBe(1);
      expect(result.wakeReleases).toBe(1);
    },
  );

  it("does not request a resampler when the output rate already matches", () => {
    const result = setupProbe(bundler, "matching-rate");
    expect(result.error).toBeNull();
    expect(result.modules).toEqual([
      { context: 0, url: "/vendor/elevenlabs/raw-audio-processor.js" },
      { context: 1, url: "/vendor/elevenlabs/audio-concat-processor.js" },
    ]);
    expect(result.contexts.map((context) => context.closeCalls)).toEqual([1, 1]);
    expect(result.trackStops).toEqual([1, 1]);
    expect(result.audioElementsRemaining).toBe(0);
  });

  it("retains SDK output cleanup when the same-origin output processor refuses to load", () => {
    const result = setupProbe(bundler, "processor-refusal");
    expect(result.error).toContain("synthetic output processor refusal");
    expect(result.modules.filter((module) => module.context === 1)).toEqual([
      { context: 1, url: "/vendor/elevenlabs/libsamplerate.worklet.js" },
      { context: 1, url: "/vendor/elevenlabs/audio-concat-processor.js" },
    ]);
    expect(result.contexts[1].closeCalls).toBe(1);
    expect(result.trackStops[0]).toBe(1);
    expect(result.audioElementsRemaining).toBe(0);
    expect(result.socketCloseCalls).toBe(1);
    expect(result.wakeReleases).toBe(1);
  });

  it("leaves the WebRTC setup branch and its connection-provided controllers intact", () => {
    const result = setupProbe(bundler, "webrtc");
    expect(result.error).toBeNull();
    expect(result.webRtcCreates).toBe(1);
    expect(result.webRtcControllersRetained).toBe(true);
    expect(result.modules).toEqual([]);
    expect(result.contexts).toEqual([]);
    expect(result.trackStops).toEqual([1]);
    expect(result.audioElementsRemaining).toBe(0);
    expect(result.socketCloseCalls).toBe(0);
    expect(result.wakeReleases).toBe(1);
  });
});
