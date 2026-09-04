// The three surfaces that take a photo, and the one seam they share.
//
// A wrapped web app that opens WKWebView's own file chooser where a phone
// would open its camera is the thin-wrapper tell App Review names, so every
// photo surface routes through lib/nativeCamera.ts inside the shell and keeps
// its web input off it. Nothing in a browser reproduces that: the sheet
// belongs to the operating system. So this fence reads the source, the way
// __tests__/profilePhotoPicker.test.ts reads it for the picker law.

import { readFileSync } from "node:fs";
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
      expect(source).toContain(`captureNativePhoto("${surface}")`);
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
