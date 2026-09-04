// Tree fence for the native camera seam.
//
// TWO rules, and they pull against each other on purpose.
//
// The first is the law `__tests__/profilePhotoPicker.test.ts` already holds:
// beat one is a PICKER, never a camera. That fence judges the `capture`
// attribute, which is the thing that takes the photo library off the iOS sheet.
// The native seam is allowed on those same swept surfaces only because
// `CameraSource.Prompt` does the opposite — it offers the camera AND the
// library — so this file pins that word. `CameraSource.Camera` would take the
// library away again, from the other side, and no browser test would notice.
//
// The second is that the seam is not a free capability: WHICH surfaces may open
// a camera is a decision, so it is written down once in NATIVE_CAMERA_SURFACES
// and swept for here. A profile avatar or a backdrop is almost always a photo
// somebody already has, so those surfaces are deliberately absent.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NATIVE_CAMERA_SURFACES } from "@/lib/nativeCamera";

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

/** Every browser-reachable source file, so a new caller cannot hide in a
 * directory this fence never thought to look in. */
function sweptFiles(): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry)) out.push(path.slice(ROOT.length + 1));
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(join(ROOT, dir));
  return out;
}

describe("the native camera keeps the photo library on the sheet", () => {
  const seam = read("lib/nativeCamera.ts");

  it("asks for the prompt sheet and never for the camera alone", () => {
    // The SOURCE the call passes, not the prose around it: the comment above
    // that call has to be free to name the value it is warning against.
    expect(seam).toContain("source: CameraSource.Prompt,");
    expect(seam).not.toContain("source: CameraSource.Camera");
  });

  it("reports a refusal apart from a cancel", () => {
    // getPhoto throws the same way for both, so the permission state is read
    // back rather than guessed at: a person whose camera the OS is holding shut
    // is told where to go, and a person who simply changed their mind is not
    // shown an error at all.
    expect(seam).toContain("checkPermissions");
    expect(seam).toContain('outcome: "blocked"');
    expect(seam).toContain('outcome: "cancelled"');
  });
});

describe("only the declared surfaces open a camera", () => {
  const callers = sweptFiles().filter(
    (file) =>
      file !== "lib/nativeCamera.ts" &&
      /\b(pickNativePhoto|captureNativePhoto)\b/.test(read(file)),
  );

  it("finds the callers, so the sweep is not passing on an empty list", () => {
    expect(callers.length).toBeGreaterThan(0);
  });

  it("holds every caller to the written-down set", () => {
    expect([...callers].sort()).toEqual([...NATIVE_CAMERA_SURFACES].sort());
  });

  it("leaves the profile photo journey on the plain library picker", () => {
    for (const surface of NATIVE_CAMERA_SURFACES) {
      expect(surface.startsWith("components/profile/"), surface).toBe(false);
      expect(surface.startsWith("app/u/"), surface).toBe(false);
    }
  });
});
