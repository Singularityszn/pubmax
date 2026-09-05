// What the Moment composer does with a chosen file, before any of it reaches
// the draft: open it, keep it, or fit it under the wire limit.

import { describe, expect, it } from "vitest";

import {
  MOMENT_FIT_LONG_EDGES,
  MOMENT_FIT_QUALITIES,
  MOMENT_PHOTO_FIT_FAILED_LINE,
  MOMENT_PHOTO_WRONG_TYPE_LINE,
  MOMENT_PICK_MAX_BYTES,
  momentFitBox,
  momentFitFileName,
  momentPhotoIntakeDecision,
  momentPhotoStillTooLargeLine,
  momentPhotoTooLargeLine,
  momentPickerHint,
  planMomentFitAttempts,
} from "@/lib/momentPhotoIntake";
import { UPLOAD_PHOTO_MAX_BYTES, UPLOAD_PHOTO_MAX_LABEL } from "@/lib/uploadBodyLimit";

const MB = 1024 * 1024;

const jpeg = (size: number, name = "night.jpg") => ({ type: "image/jpeg", name, size });

describe("the intake decision", () => {
  it("keeps a photo already under the wire limit byte for byte", () => {
    expect(momentPhotoIntakeDecision(jpeg(UPLOAD_PHOTO_MAX_BYTES))).toEqual({ outcome: "keep" });
    expect(momentPhotoIntakeDecision({ type: "image/png", name: "n.png", size: 31 * 1024 })).toEqual({ outcome: "keep" });
    expect(momentPhotoIntakeDecision({ type: "image/webp", name: "n.webp", size: 31 * 1024 })).toEqual({ outcome: "keep" });
  });

  it("fits the phone's own photo rather than refusing the phone", () => {
    // The battle test's fixture: 8,060,438 bytes, 413 on both routes.
    expect(momentPhotoIntakeDecision(jpeg(8_060_438, "mid.jpg"))).toEqual({ outcome: "fit", reason: "size" });
    expect(momentPhotoIntakeDecision(jpeg(UPLOAD_PHOTO_MAX_BYTES + 1))).toEqual({ outcome: "fit", reason: "size" });
  });

  it("fits an iPhone's HEIC whatever it weighs, by type or by name", () => {
    // Safari reports the library's own type; some browsers report none and
    // leave only the extension. Either way the fit is what makes it a JPEG.
    expect(momentPhotoIntakeDecision({ type: "image/heic", name: "IMG_0042.HEIC", size: 2 * MB })).toEqual({ outcome: "fit", reason: "heic" });
    expect(momentPhotoIntakeDecision({ type: "image/heif", name: "IMG_0042.heif", size: 2 * MB })).toEqual({ outcome: "fit", reason: "heic" });
    expect(momentPhotoIntakeDecision({ type: "", name: "IMG_0042.HEIC", size: 2 * MB })).toEqual({ outcome: "fit", reason: "heic" });
  });

  it("refuses a file that is none of the four photo types", () => {
    for (const type of ["image/gif", "image/svg+xml", "application/pdf", ""]) {
      expect(momentPhotoIntakeDecision({ type, name: "thing.bin", size: MB })).toEqual({
        outcome: "refuse",
        message: MOMENT_PHOTO_WRONG_TYPE_LINE,
      });
    }
  });

  it("refuses what no phone produces, and an empty file", () => {
    expect(MOMENT_PICK_MAX_BYTES).toBeGreaterThan(UPLOAD_PHOTO_MAX_BYTES);
    expect(momentPhotoIntakeDecision(jpeg(MOMENT_PICK_MAX_BYTES + 1))).toEqual({
      outcome: "refuse",
      message: momentPhotoTooLargeLine(),
    });
    expect(momentPhotoIntakeDecision(jpeg(0)).outcome).toBe("refuse");
  });
});

describe("the fit ladder", () => {
  it("walks every edge at every quality, largest and best first", () => {
    const attempts = planMomentFitAttempts({ width: 4032, height: 3024 });
    expect(attempts[0]).toEqual({ longEdge: MOMENT_FIT_LONG_EDGES[0], quality: MOMENT_FIT_QUALITIES[0] });
    expect(attempts).toHaveLength(MOMENT_FIT_LONG_EDGES.length * MOMENT_FIT_QUALITIES.length);
    for (let index = 1; index < attempts.length; index += 1) {
      const previous = attempts[index - 1];
      const current = attempts[index];
      const notLarger = current.longEdge < previous.longEdge
        || (current.longEdge === previous.longEdge && current.quality < previous.quality);
      expect(notLarger).toBe(true);
    }
  });

  it("never draws a photo larger than it is", () => {
    const attempts = planMomentFitAttempts({ width: 1500, height: 1000 });
    expect(attempts.map((attempt) => attempt.longEdge)).toEqual([1500, 1500, 1500, 1280, 1280, 1280]);
    expect(momentFitBox({ width: 1500, height: 1000 }, 2560)).toEqual({ width: 1500, height: 1000 });
  });

  it("keeps the aspect when it scales", () => {
    expect(momentFitBox({ width: 4032, height: 3024 }, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(momentFitBox({ width: 3024, height: 4032 }, 1280)).toEqual({ width: 960, height: 1280 });
  });

  it("names the fitted JPEG after the photo it came from", () => {
    expect(momentFitFileName("IMG_0042.HEIC")).toBe("IMG_0042.jpg");
    expect(momentFitFileName("night.png")).toBe("night.jpg");
    expect(momentFitFileName("")).toBe("moment-photo.jpg");
  });
});

describe("the composer's own words carry the real number", () => {
  it("under the picker at both widths", () => {
    expect(momentPickerHint(true)).toContain(UPLOAD_PHOTO_MAX_LABEL);
    expect(momentPickerHint(false)).toContain(UPLOAD_PHOTO_MAX_LABEL);
    expect(momentPickerHint(true)).toContain("Camera or library");
    expect(momentPickerHint(false)).toContain("HEIC");
    for (const line of [momentPickerHint(true), momentPickerHint(false)]) {
      expect(line).not.toMatch(/10 ?MB/);
    }
  });

  it("in every refusal about size", () => {
    expect(momentPhotoTooLargeLine()).toContain(`${MOMENT_PICK_MAX_BYTES / MB} MB`);
    expect(MOMENT_PHOTO_FIT_FAILED_LINE).toContain(UPLOAD_PHOTO_MAX_LABEL);
    expect(momentPhotoStillTooLargeLine("night.jpg")).toContain("night.jpg");
    expect(momentPhotoStillTooLargeLine("night.jpg")).toContain(UPLOAD_PHOTO_MAX_LABEL);
  });
});
