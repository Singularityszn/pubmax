// What the Moment composer does with a chosen file, before any of it reaches
// the draft: open it, keep it, or fit it under the wire limit.

import { describe, expect, it } from "vitest";

import {
  MOMENT_FIT_LONG_EDGES,
  MOMENT_FIT_QUALITIES,
  keepServerMemoryAfterRefusal,
  MOMENT_PHOTO_FIT_FAILED_LINE,
  MOMENT_PHOTO_NOT_A_PHOTO_LINE,
  MOMENT_PHOTO_WRONG_TYPE_LINE,
  MOMENT_PICK_MAX_BYTES,
  NIGHT_MEMORY_REFUSED_CODE,
  PHOTO_SNIFF_BYTES,
  sniffPhotoKind,
  type MomentPhotoKind,
  momentFitBox,
  momentFitFileName,
  momentPhotoIntakeDecision,
  momentPhotoStillTooLargeLine,
  momentPhotoTooLargeLine,
  momentPickerHint,
  planMomentFitAttempts,
} from "@/lib/momentPhotoIntake";
import { UPLOAD_PHOTO_MAX_BYTES, UPLOAD_PHOTO_MAX_LABEL } from "@/lib/uploadBodyLimit";
import { defined } from "@/__tests__/helpers/defined";

const MB = 1024 * 1024;

const jpeg = (size: number, name = "night.jpg") => ({ type: "image/jpeg", name, size, kind: "jpeg" as const });
const of = (type: string, name: string, size: number, kind: MomentPhotoKind | null) => ({ type, name, size, kind });

const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x48]);
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const WEBP_HEAD = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const heicHead = (brand: string) => new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, ...brand.split("").map((c) => c.charCodeAt(0)), 0x00, 0x00, 0x00, 0x00]);
const TEXT_HEAD = new TextEncoder().encode("hello, this is not a photo at all");

describe("the byte sniff", () => {
  it("names each of the four containers off the bytes the server reads", () => {
    expect(sniffPhotoKind(JPEG_HEAD)).toBe("jpeg");
    expect(sniffPhotoKind(PNG_HEAD)).toBe("png");
    expect(sniffPhotoKind(WEBP_HEAD)).toBe("webp");
    for (const brand of ["heic", "heix", "mif1", "msf1", "HEIC"]) {
      expect(sniffPhotoKind(heicHead(brand))).toBe("heic");
    }
  });

  it("names nothing for text, an MP4 and a truncated head", () => {
    expect(sniffPhotoKind(TEXT_HEAD)).toBeNull();
    expect(sniffPhotoKind(heicHead("isom"))).toBeNull();
    expect(sniffPhotoKind(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffPhotoKind(new Uint8Array())).toBeNull();
  });

  it("needs no more than the leading bytes the composer reads", () => {
    for (const head of [JPEG_HEAD, PNG_HEAD, WEBP_HEAD, heicHead("heic")]) {
      expect(sniffPhotoKind(head.slice(0, PHOTO_SNIFF_BYTES))).toBe(sniffPhotoKind(head));
    }
  });
});

describe("the intake decision", () => {
  it("refuses a file whose bytes are not a photo, whatever its name says", () => {
    // A text file called night.jpg arrives typed image/jpeg by its extension.
    expect(momentPhotoIntakeDecision(of("image/jpeg", "night.jpg", 40, null))).toEqual({
      outcome: "refuse",
      message: MOMENT_PHOTO_NOT_A_PHOTO_LINE,
    });
  });

  it("declares what the bytes are, not what the name said", () => {
    expect(momentPhotoIntakeDecision(of("image/png", "photo.png", MB, "jpeg"))).toEqual({ outcome: "keep", type: "image/jpeg" });
  });

  it("keeps a photo already under the wire limit byte for byte", () => {
    expect(momentPhotoIntakeDecision(jpeg(UPLOAD_PHOTO_MAX_BYTES))).toEqual({ outcome: "keep", type: "image/jpeg" });
    expect(momentPhotoIntakeDecision(of("image/png", "n.png", 31 * 1024, "png"))).toEqual({ outcome: "keep", type: "image/png" });
    expect(momentPhotoIntakeDecision(of("image/webp", "n.webp", 31 * 1024, "webp"))).toEqual({ outcome: "keep", type: "image/webp" });
  });

  it("fits the phone's own photo rather than refusing the phone", () => {
    // The battle test's fixture: 8,060,438 bytes, 413 on both routes.
    expect(momentPhotoIntakeDecision(jpeg(8_060_438, "mid.jpg"))).toEqual({ outcome: "fit", reason: "size" });
    expect(momentPhotoIntakeDecision(jpeg(UPLOAD_PHOTO_MAX_BYTES + 1))).toEqual({ outcome: "fit", reason: "size" });
  });

  it("fits an iPhone's HEIC whatever it weighs, by type or by name", () => {
    // Safari reports the library's own type; some browsers report none and
    // leave only the extension. Either way the fit is what makes it a JPEG.
    expect(momentPhotoIntakeDecision(of("image/heic", "IMG_0042.HEIC", 2 * MB, "heic"))).toEqual({ outcome: "fit", reason: "heic" });
    expect(momentPhotoIntakeDecision(of("image/heif", "IMG_0042.heif", 2 * MB, "heic"))).toEqual({ outcome: "fit", reason: "heic" });
    expect(momentPhotoIntakeDecision(of("", "IMG_0042.HEIC", 2 * MB, "heic"))).toEqual({ outcome: "fit", reason: "heic" });
  });

  it("refuses a file that is none of the four photo types", () => {
    for (const type of ["image/gif", "image/svg+xml", "application/pdf", ""]) {
      expect(momentPhotoIntakeDecision(of(type, "thing.bin", MB, null))).toEqual({
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
      const previous = defined(attempts[index - 1]);
      const current = defined(attempts[index]);
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

describe("what a refused Moment write does to the Memory it was for", () => {
  it("keeps the Memory across a refusal about the photo", () => {
    expect(keepServerMemoryAfterRefusal(400, "INVALID_REQUEST")).toBe(true);
    expect(keepServerMemoryAfterRefusal(413, "TOO_LARGE")).toBe(true);
    expect(keepServerMemoryAfterRefusal(503, "UNAVAILABLE")).toBe(true);
    expect(keepServerMemoryAfterRefusal(null, undefined)).toBe(true);
  });

  it("drops it only for a refusal about the Memory, or a Memory that is gone", () => {
    expect(keepServerMemoryAfterRefusal(400, NIGHT_MEMORY_REFUSED_CODE)).toBe(false);
    expect(keepServerMemoryAfterRefusal(404, "NOT_FOUND")).toBe(false);
  });
});

describe("the composer's own words carry the real number", () => {
  it("under the picker at both widths, one sentence per line", () => {
    const phone = momentPickerHint(true);
    const desk = momentPickerHint(false);
    expect(phone.join(" ")).toContain(UPLOAD_PHOTO_MAX_LABEL);
    expect(desk.join(" ")).toContain(UPLOAD_PHOTO_MAX_LABEL);
    expect(phone[0]).toBe("Camera or library.");
    expect(desk[0]).toContain("HEIC");
    for (const line of [...phone, ...desk]) {
      expect(line).not.toMatch(/10 ?MB/);
      // A line is one sentence, short enough to stand unwrapped on a phone.
      expect(line.length).toBeLessThanOrEqual(30);
      expect(line.endsWith(".")).toBe(true);
    }
  });

  it("in every refusal about size", () => {
    expect(momentPhotoTooLargeLine()).toContain(`${MOMENT_PICK_MAX_BYTES / MB} MB`);
    expect(MOMENT_PHOTO_FIT_FAILED_LINE).toContain(UPLOAD_PHOTO_MAX_LABEL);
    expect(momentPhotoStillTooLargeLine("night.jpg")).toContain("night.jpg");
    expect(momentPhotoStillTooLargeLine("night.jpg")).toContain(UPLOAD_PHOTO_MAX_LABEL);
  });
});
