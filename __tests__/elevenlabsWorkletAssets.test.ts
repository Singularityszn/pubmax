import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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
  it("copies the packaged modules onto the paths a voice session requests", () => {
    const scripts = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ).scripts as Record<string, string>;
    expect(scripts["prepare:maplibre-worker"]).toContain(
      "scripts/copy_elevenlabs_worklets.mjs",
    );
    expect(scripts.predev).toBe("npm run prepare:maplibre-worker");
    expect(scripts.prebuild).toContain("npm run prepare:maplibre-worker");

    execFileSync(process.execPath, ["scripts/copy_elevenlabs_worklets.mjs"], {
      cwd: ROOT,
    });

    for (const [url, specifier] of Object.entries(PACKAGED)) {
      const served = readFileSync(join(ROOT, "public", url));
      const packaged = readFileSync(require.resolve(specifier));
      expect(Buffer.compare(served, packaged), url).toBe(0);
    }
  });
});
