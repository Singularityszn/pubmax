import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ELEVENLABS_LIBSAMPLERATE_PATH,
  ELEVENLABS_WORKLET_PATHS,
} from "@/lib/elevenlabsWorkletAssets";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

const PACKAGED = {
  [ELEVENLABS_WORKLET_PATHS.rawAudioProcessor]:
    "@elevenlabs/client/worklets/rawAudioProcessor.js",
  [ELEVENLABS_WORKLET_PATHS.audioConcatProcessor]:
    "@elevenlabs/client/worklets/audioConcatProcessor.js",
  [ELEVENLABS_LIBSAMPLERATE_PATH]:
    "@alexanderolsen/libsamplerate-js/dist/libsamplerate.worklet.js",
} as const;

describe("self-hosted ElevenLabs worklets", () => {
  it("writes the packaged modules onto the paths a voice session requests when the dev prepare step runs", () => {
    rmSync(join(ROOT, "public", "vendor", "elevenlabs"), {
      recursive: true,
      force: true,
    });

    execFileSync("npm", ["run", "prepare:maplibre-worker"], { cwd: ROOT, stdio: "pipe" });

    for (const [url, specifier] of Object.entries(PACKAGED)) {
      const served = readFileSync(join(ROOT, "public", url));
      const packaged = readFileSync(require.resolve(specifier));
      expect(Buffer.compare(served, packaged), url).toBe(0);
    }
  });
});
