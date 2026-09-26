// The three surfaces that take a photo, and the one seam they share.
//
// A wrapped web app that opens WKWebView's own file chooser where a phone
// would open its camera is the thin-wrapper tell App Review names, so every
// photo surface routes through lib/nativeCamera.ts inside the shell and keeps
// its web input off it. Nothing in a browser reproduces that: the sheet
// belongs to the operating system. So this fence reads the source, the way
// __tests__/profilePhotoPicker.test.ts reads it for the picker law.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  NATIVE_PHOTO_SURFACES,
  nativePhotoFileName,
  nativePhotoMediaType,
} from "@/lib/nativeCamera";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

/** Each surface, the component that owns it, and the web door it keeps. */
const SURFACES = [
  { surface: "pint", file: "components/map/VenuePriceSubmit.tsx", webDoor: "pintPhotoInputRef.current?.click()" },
  { surface: "venue", file: "components/venue/VenuePhotoComposer.tsx", webDoor: "inputRef.current?.click()" },
  { surface: "moment", file: "components/moment/MomentCapture.tsx", webDoor: null },
] as const;

/** Callers whose shell-first, web-second behaviour is proven by rendering them
 * (`__tests__/drinkWallComposer.test.tsx`), not by the table above. */
const RENDERED_SURFACES = ["components/drink-wall/DrinkWallComposer.tsx"] as const;

describe("a photo surface asks the shell first and the web input second", () => {
  it("names every surface the seam knows about", () => {
    expect([...NATIVE_PHOTO_SURFACES].sort()).toEqual(
      SURFACES.map((entry) => entry.surface).sort(),
    );
  });

  for (const { surface, file, webDoor } of SURFACES) {
    it(`${surface} routes through the seam under its own name`, () => {
      const source = read(file);
      expect(source).toContain('from "@/lib/nativeCamera"');
      // Either entry point, but the surface NAME has to reach the seam: that
      // name becomes the file name the phone hands over. `pickNativePhoto` is
      // the three-way form, for a surface with somewhere to show a refusal;
      // `captureNativePhoto` is the two-way wrapper over it.
      expect(
        source.includes(`pickNativePhoto("${surface}")`) ||
          source.includes(`captureNativePhoto("${surface}")`),
        `${file} does not hand "${surface}" to the seam`,
      ).toBe(true);
      // The shell branch is what makes the file input the fallback rather than
      // the only door, so the gate has to be in the same file.
      expect(source).toContain("isNativeApp()");
    });

    if (webDoor) {
      it(`${surface} still opens its web input off the shell`, () => {
        // Losing this is how the native wiring quietly takes the photo away
        // from every desktop and mobile browser.
        expect(read(file)).toContain(webDoor);
      });
    }
  }

  it("keeps the sheet a picker, never a forced camera", () => {
    // CameraSource.Prompt offers Camera and Photo Library together. Narrowing
    // to CameraSource.Camera is the native form of the `capture` attribute
    // that hid the iOS photo library from the avatar picker.
    const seam = read("lib/nativeCamera.ts");
    expect(seam).toContain("CameraSource.Prompt");
    expect(seam).not.toContain("CameraSource.Camera,");
  });

  it("bounds what leaves the phone", () => {
    const seam = read("lib/nativeCamera.ts");
    expect(seam).toContain("const MAX_PHOTO_EDGE = 2048;");
    expect(seam).toContain("const PHOTO_QUALITY = 85;");
  });
});

describe("what the seam calls the file it hands over", () => {
  it("names the surface that took it", () => {
    expect(nativePhotoFileName("pint", "jpeg", 1_757_000_000_000)).toBe(
      "pint-1757000000000.jpeg",
    );
    expect(nativePhotoFileName("venue", "png", 1)).toBe("venue-1.png");
  });

  it("falls back to jpeg when the plugin states no format", () => {
    expect(nativePhotoFileName("moment", undefined, 2)).toBe("moment-2.jpeg");
    expect(nativePhotoMediaType(undefined)).toBe("image/jpeg");
  });

  it("turns the plugin's container word into a real media type", () => {
    // `image/jpg` is not a media type, and the upload allow-lists that decide
    // what a person may send all name `image/jpeg`.
    expect(nativePhotoMediaType("jpg")).toBe("image/jpeg");
    expect(nativePhotoMediaType("PNG")).toBe("image/png");
  });
});

describe("the permission a person reads before they grant it", () => {
  const info = read("ios/App/App/Info.plist");

  it("names what the camera is actually for, not one surface of three", () => {
    // The old string said Moments alone, while the same permission now opens
    // for a price board and a pub wall. iOS shows this sentence once.
    expect(info).toContain("photograph a price board, a pub, or your own night");
    expect(info).not.toContain("save them as private Moments");
  });
});

describe("a refusal reaches a person, and a cancel does not", () => {
  const seam = read("lib/nativeCamera.ts");

  it("tells a denied permission apart from a changed mind", () => {
    // `getPhoto` throws identically for both, so the permission is read back
    // rather than guessed at. Collapsing them means somebody whose camera the
    // OS is holding shut taps a button that does nothing, for ever.
    expect(seam).toContain("checkPermissions");
    expect(seam).toContain('outcome: "blocked"');
    expect(seam).toContain('outcome: "cancelled"');
  });

  it("only calls it blocked when BOTH doors on the sheet are shut", () => {
    // The sheet offers camera and library. Somebody who refused the camera can
    // still pick a photo they already have, and telling them the camera is off
    // would be true and useless.
    expect(seam).toContain('permissions.camera === "denied" && permissions.photos === "denied"');
  });

  it("costs nobody anything when the permission read itself fails", () => {
    // A read we could not run is not evidence of a refusal.
    expect(seam).toMatch(/catch \{\s*return false;/);
  });

  it("says where to go, since nothing in the app can grant it", () => {
    expect(seam).toContain("Turn it on in Settings");
  });

  it("shows the refusal on the two surfaces that have a line for it", () => {
    for (const file of [
      "components/map/VenuePriceSubmit.tsx",
      "components/venue/VenuePhotoComposer.tsx",
    ]) {
      expect(read(file), file).toContain('pick.outcome === "blocked"');
    }
  });
});

describe("nothing outside the three surfaces opens a camera", () => {
  /** Every browser-reachable source file, so a new caller cannot appear in a
   * directory this fence never thought to look in. */
  function sweptFiles(): string[] {
    const out: string[] = [];
    const walk = (current: string) => {
      for (const entry of readdirSync(current)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const path = join(current, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry)) out.push(path.slice(process.cwd().length + 1));
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(join(process.cwd(), dir));
    return out;
  }

  const callers = sweptFiles().filter(
    (file) =>
      file !== "lib/nativeCamera.ts" &&
      /\b(pickNativePhoto|captureNativePhoto)\b/.test(read(file)),
  );

  it("finds the callers, so the sweep is not passing on an empty list", () => {
    expect(callers.length).toBeGreaterThan(0);
  });

  it("holds every caller to the surface table above", () => {
    expect([...callers].sort()).toEqual(
      [...SURFACES.map((entry) => entry.file), ...RENDERED_SURFACES].sort(),
    );
  });

  it("leaves the profile photo journey on the plain library picker", () => {
    // A face or a backdrop is almost always a photo somebody already has, and
    // that journey is the library picker plus the crop step.
    for (const { file } of SURFACES) {
      expect(file.startsWith("components/profile/"), file).toBe(false);
      expect(file.startsWith("app/u/"), file).toBe(false);
    }
  });
});
