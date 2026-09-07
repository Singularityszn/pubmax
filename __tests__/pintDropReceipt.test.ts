// A NEW PRICE COMES WITH THE BILL (captain 7 Sept 2026).
//
// "Whenever a person is submitting a new price, they have to take a picture of
// the bill. Let's keep that as the right way to go about it." The captain added
// the second half at 17:20: "the bill photo should be mandatory, along with the
// picture of the pint or something, just to make it more fun."
//
// So a price and its proof arrive together, and the pint photo stays the
// optional, cheerful one beside it. This file pins the rule where it is
// decided, and the words it is asked for in.
//
// The 4 Sep ruling stands: an ANONYMOUS drop with a receipt is still one
// account. The receipt is evidence about the price, never a second identity.

import { describe, expect, it } from "vitest";

import {
  PINT_PHOTO_FUN_LINE,
  RECEIPT_PHOTO_LABEL,
  RECEIPT_REQUIRED_LINE,
  photoRefusal,
  priceNeedsReceipt,
} from "@/lib/pintDropReceipt";

function file(bytes: number, type = "image/jpeg"): File {
  return new File([new Uint8Array(bytes)], "bill.jpg", { type });
}

describe("which submissions need the bill", () => {
  it("asks for one on every new price", () => {
    expect(priceNeedsReceipt(4.5)).toBe(true);
    expect(priceNeedsReceipt("4.50")).toBe(true);
  });

  it("asks for nothing on a drop that carries no price", () => {
    // A Pint Drop can be a note, a photo of the pub or a bit of lore. Only a
    // PRICE is a claim a reader needs to be able to check.
    expect(priceNeedsReceipt(null)).toBe(false);
    expect(priceNeedsReceipt("")).toBe(false);
    expect(priceNeedsReceipt(undefined)).toBe(false);
  });
});

describe("the words", () => {
  it("says what to do and why, in one line", () => {
    expect(RECEIPT_REQUIRED_LINE).toMatch(/bill/i);
    // One line, not a paragraph, and it explains rather than scolds.
    expect(RECEIPT_REQUIRED_LINE.length).toBeLessThanOrEqual(90);
    expect(RECEIPT_REQUIRED_LINE).not.toMatch(/must|cannot|invalid|error/i);
  });

  it("names the row's own label and keeps the pint photo cheerful", () => {
    expect(RECEIPT_PHOTO_LABEL).toBe("Receipt");
    expect(PINT_PHOTO_FUN_LINE).toMatch(/pint/i);
  });
});

describe("what a photo may be, in one place for both doors", () => {
  it("takes a JPEG, a PNG and a WebP", () => {
    expect(photoRefusal(file(10, "image/jpeg"))).toBeNull();
    expect(photoRefusal(file(10, "image/png"))).toBeNull();
    expect(photoRefusal(file(10, "image/webp"))).toBeNull();
  });

  it("refuses another type, and says which three it takes", () => {
    const refusal = photoRefusal(file(10, "application/pdf"));
    expect(refusal).toMatch(/JPEG/);
    expect(refusal).toMatch(/PNG/);
    expect(refusal).toMatch(/WebP/);
  });

  it("refuses a file over the wire's own limit, quoting that figure", async () => {
    const { UPLOAD_PHOTO_MAX_BYTES, UPLOAD_PHOTO_MAX_LABEL } = await import(
      "@/lib/uploadBodyLimit"
    );
    expect(photoRefusal(file(UPLOAD_PHOTO_MAX_BYTES))).toBeNull();
    expect(photoRefusal(file(UPLOAD_PHOTO_MAX_BYTES + 1))).toContain(UPLOAD_PHOTO_MAX_LABEL);
  });
});
