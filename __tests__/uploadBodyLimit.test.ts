import { describe, expect, it } from "vitest";

import { MOMENT_MAX_PHOTO_BYTES } from "@/lib/momentPhotoEditor";
import {
  FUNCTION_REQUEST_BODY_LIMIT_BYTES,
  photoFitsUploadBody,
  UPLOAD_FIELDS_ALLOWANCE_BYTES,
  UPLOAD_PHOTO_MAX_BYTES,
  UPLOAD_PHOTO_MAX_LABEL,
} from "@/lib/uploadBodyLimit";
import { photoRefusal } from "@/lib/pintDropReceipt";
import { validatePhoto } from "@/lib/pintDropsStore";
import { UPLOADED_IMAGE_MAX_BYTES } from "@/lib/uploadedImage.server";

describe("one photo on the wire fits inside the function's own body limit", () => {
  it("leaves room for the multipart fields beside it", () => {
    expect(UPLOAD_PHOTO_MAX_BYTES + UPLOAD_FIELDS_ALLOWANCE_BYTES).toBeLessThan(
      FUNCTION_REQUEST_BODY_LIMIT_BYTES,
    );
  });

  it("is the number the platform documents, in the platform's own megabytes", () => {
    expect(FUNCTION_REQUEST_BODY_LIMIT_BYTES).toBe(4_500_000);
    expect(UPLOAD_PHOTO_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(UPLOAD_PHOTO_MAX_LABEL).toBe("4\u00a0MB");
  });

  it("answers the fit question at the boundary", () => {
    expect(photoFitsUploadBody(UPLOAD_PHOTO_MAX_BYTES)).toBe(true);
    expect(photoFitsUploadBody(UPLOAD_PHOTO_MAX_BYTES + 1)).toBe(false);
    expect(photoFitsUploadBody(0)).toBe(false);
    expect(photoFitsUploadBody(Number.NaN)).toBe(false);
  });
});

describe("every server photo cap reads the wire limit", () => {
  it("through the Moment boundary and the shared image journey", () => {
    expect(MOMENT_MAX_PHOTO_BYTES).toBe(UPLOAD_PHOTO_MAX_BYTES);
    expect(UPLOADED_IMAGE_MAX_BYTES).toBe(UPLOAD_PHOTO_MAX_BYTES);
  });

  it.each(["image/jpeg", "image/png", "image/webp"])(
    "accepts %s at the wire boundary and refuses heavier photos on both sides",
    (type) => {
      const accepted = new File([new Uint8Array(UPLOAD_PHOTO_MAX_BYTES)], "photo", { type });
      const rejected = new File([new Uint8Array(UPLOAD_PHOTO_MAX_BYTES + 1)], "photo", { type });
      expect(photoRefusal(accepted)).toBeNull();
      expect(validatePhoto(type, accepted.size)).toBeNull();
      expect(photoRefusal(rejected)).toBe("Each photo must be under 4\u00a0MB.");
      expect(validatePhoto(type, rejected.size)).toBe("Photo must be 4\u00a0MB or smaller.");
    },
  );
});
