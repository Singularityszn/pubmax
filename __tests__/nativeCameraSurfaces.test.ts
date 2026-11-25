// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { nativePhotoFileName, nativePhotoMediaType } from "@/lib/nativeCamera";
import { plistRoot } from "@/__tests__/helpers/plist";

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

describe("the iOS camera permission contract", () => {
  it("provides a camera usage description for every photo surface", () => {
    const info = plistRoot("ios/App/App/Info.plist");
    expect(info.NSCameraUsageDescription).toEqual(expect.any(String));
    expect(String(info.NSCameraUsageDescription).trim().length).toBeGreaterThan(0);
  });
});
