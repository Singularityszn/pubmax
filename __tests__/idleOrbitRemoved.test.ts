import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The idle ambient orbit is GONE, and this is the fence that keeps it gone.
//
// It turned the map at 0.6 degrees a second whenever the reader stopped
// touching it, writing the camera four times a second through `jumpTo`. So a
// bearing somebody had chosen decayed on its own, the pins crawled with it, and
// every step forced fresh tiles. Captain decision, 3 Sep 2026: delete it. There
// is no flag and no reduced-motion variant to bring back - an ambient camera is
// not something this map has.
//
// The fence reads the SOURCE rather than a list of files known to be clean,
// because a new module is exactly where a second orbit would land.

const ROOT = join(__dirname, "..");

const SOURCE_DIRS = ["app", "components", "lib"];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

function allSourceFiles(): string[] {
  return SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)));
}

describe("the idle ambient orbit is gone", () => {
  it("has no module left to import", () => {
    expect(existsSync(join(ROOT, "lib/mapOrbit.ts"))).toBe(false);
  });

  it("is named nowhere in the tree", () => {
    const offenders = allSourceFiles().filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        source.includes("lib/mapOrbit") ||
        source.includes("createIdleOrbit") ||
        source.includes("orbitBearingStep") ||
        source.includes("shouldPublishOrbitViewport")
      );
    });
    expect(offenders).toEqual([]);
  });
});

describe("nothing turns this camera on a timer", () => {
  const canvas = readFileSync(join(ROOT, "components/PubMapCanvas.tsx"), "utf8");

  // The orbit's own step was `jumpTo({ bearing: ... })`. Both surviving jumps
  // in the canvas restore a whole remembered camera (a resumed session, a
  // WebGL context rebuild); neither invents a rotation.
  it("never jumps the camera to a bearing of its own", () => {
    expect(canvas).not.toMatch(/jumpTo\(\s*\{\s*bearing/);
    expect(canvas).not.toMatch(/getBearing\(\)\s*[-+]\s*step/);
  });

  it("keeps the reader's rotation off every repeating timer", () => {
    for (const [, body] of canvas.matchAll(/setInterval\(([\s\S]{0,600}?)\)\s*;/g)) {
      expect(body).not.toMatch(/bearing|setBearing|rotateTo|easeTo|flyTo|jumpTo/);
    }
  });
});

describe("the camera lane stands down while a reader holds the map", () => {
  const lane = readFileSync(join(ROOT, "components/map/canvas/useMapCamera.ts"), "utf8");

  it("asks the gesture guard before it moves anything", () => {
    expect(lane).toContain("cameraIntentBlocked");
  });
});
