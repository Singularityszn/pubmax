import { describe, expect, it } from "vitest";

import {
  MOMENT_MAX_PHOTO_BYTES,
  replaceMomentMediaWithEditedBlob,
  type EditedMomentPhotoResult,
} from "@/lib/momentPhotoEditor";
import type { MomentMediaDraft } from "@/lib/momentDraft";
import { validatePhoto } from "@/lib/pintDropsStore";

function media(overrides: Partial<MomentMediaDraft> = {}): MomentMediaDraft {
  return {
    id: "photo-1",
    type: "image",
    name: "night.jpg",
    mimeType: "image/jpeg",
    size: 10,
    blob: new Blob(["original"], { type: "image/jpeg" }),
    objectUrl: "blob:original",
    width: null,
    height: null,
    focalX: 0.5,
    focalY: 0.5,
    alt: "Friends outside the pub",
    ...overrides,
  };
}

function edited(blob: Blob): EditedMomentPhotoResult {
  return { blob };
}

describe("Moment photo editor output", () => {
  it("replaces selected photo bytes while preserving identity and alt text", () => {
    const original = media();
    const result = replaceMomentMediaWithEditedBlob(original, edited(new Blob(["edited"], { type: "image/jpeg" })));

    expect(result.error).toBeNull();
    expect(result.media.id).toBe(original.id);
    expect(result.media.alt).toBe(original.alt);
    expect(result.media.name).toBe("night-edited.jpg");
    expect(result.media.mimeType).toBe("image/jpeg");
    expect(result.media.size).toBe(6);
    expect(result.media.blob).not.toBe(original.blob);
    expect(result.media.objectUrl).toMatch(/^blob:/);
  });

  it("keeps original when editor output is outside upload constraints", () => {
    const original = media();
    const unsupported = replaceMomentMediaWithEditedBlob(
      original,
      edited(new Blob(["edited"], { type: "image/gif" })),
    );
    expect(unsupported.media).toBe(original);
    expect(unsupported.error).toMatch(/JPEG, PNG, or WebP/i);

    const oversized = replaceMomentMediaWithEditedBlob(
      original,
      edited(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/jpeg" })),
    );
    expect(oversized.media).toBe(original);
    expect(oversized.error).toMatch(/5MB/i);
  });

  it("matches the existing Moment upload size boundary", () => {
    const accepted = new Blob([new Uint8Array(MOMENT_MAX_PHOTO_BYTES)], { type: "image/jpeg" });
    const rejected = new Blob([new Uint8Array(MOMENT_MAX_PHOTO_BYTES + 1)], { type: "image/jpeg" });

    expect(validatePhoto(accepted.type, accepted.size)).toBeNull();
    expect(validatePhoto(rejected.type, rejected.size)).toMatch(/5MB/);
  });
});
