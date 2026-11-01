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
  PRICE_EVIDENCE,
  RECEIPT_OPTIONAL_LINE,
  RECEIPT_PHOTO_LABEL,
  RECEIPT_REQUIRED_LINE,
  cleanPriceEvidence,
  isPricedWrite,
  isUncheckedPrice,
  photoRefusal,
  priceEvidenceFor,
  priceNeedsReceipt,
} from "@/lib/pintDropReceipt";

function file(bytes: number, type = "image/jpeg"): File {
  return new File([new Uint8Array(bytes)], "bill.jpg", { type });
}

describe("which submissions are offered the bill", () => {
  it("offers one on every new price", () => {
    expect(isPricedWrite(4.5)).toBe(true);
    expect(isPricedWrite("4.50")).toBe(true);
    // The one-tap community price door and the Round diary still owe one.
    expect(priceNeedsReceipt(4.5)).toBe(true);
    expect(priceNeedsReceipt("4.50")).toBe(true);
  });

  it("asks for nothing on a drop that carries no price", () => {
    // A Pint Drop can be a note, a photo of the pub or a bit of lore. Only a
    // PRICE is a claim a reader needs to be able to check.
    expect(isPricedWrite(null)).toBe(false);
    expect(isPricedWrite("")).toBe(false);
    expect(isPricedWrite(undefined)).toBe(false);
    expect(priceNeedsReceipt(null)).toBe(false);
  });
});

// Captain decision 9 (1 Nov 2026): a typed price without a receipt photo is
// accepted at the Pint Drop door, and is UNCHECKED until a second drinker
// agrees. The evidence is a closed set, and a write earns it from what arrived.
describe("what stands behind a price", () => {
  it("is a closed set of two, mirrored by migration 0218's CHECK", () => {
    expect(PRICE_EVIDENCE).toEqual(["receipt", "unchecked"]);
    expect(cleanPriceEvidence("unchecked")).toBe("unchecked");
    expect(cleanPriceEvidence("receipt")).toBe("receipt");
    expect(cleanPriceEvidence("checked")).toBeUndefined();
    expect(cleanPriceEvidence(null)).toBeUndefined();
  });

  it("is earned from whether a bill arrived, and only by a price", () => {
    expect(priceEvidenceFor(4.5, true)).toBe("receipt");
    expect(priceEvidenceFor(4.5, false)).toBe("unchecked");
    expect(priceEvidenceFor(null, true)).toBeUndefined();
    expect(priceEvidenceFor(Number.NaN, false)).toBeUndefined();
  });

  it("calls only the explicit word unchecked; a row written before 0218 is not", () => {
    expect(isUncheckedPrice({ priceEvidence: "unchecked" })).toBe(true);
    expect(isUncheckedPrice({ priceEvidence: "receipt" })).toBe(false);
    expect(isUncheckedPrice({})).toBe(false);
    expect(isUncheckedPrice(null)).toBe(false);
  });
});

describe("the words", () => {
  it("says what to do and why, in one line", () => {
    expect(RECEIPT_REQUIRED_LINE).toMatch(/bill/i);
    // One line, not a paragraph, and it explains rather than scolds.
    expect(RECEIPT_REQUIRED_LINE.length).toBeLessThanOrEqual(90);
    expect(RECEIPT_REQUIRED_LINE).not.toMatch(/must|cannot|invalid|error/i);
  });

  it("offers the optional bill in one short line that does not nag", () => {
    expect(RECEIPT_OPTIONAL_LINE).toMatch(/bill/i);
    expect(RECEIPT_OPTIONAL_LINE).toMatch(/map/i);
    expect(RECEIPT_OPTIONAL_LINE.length).toBeLessThanOrEqual(80);
    expect(RECEIPT_OPTIONAL_LINE).not.toMatch(/must|need|have to|required|please|!/i);
    // It may claim the mark, never the colour (CommunityPriceMapReach).
    expect(RECEIPT_OPTIONAL_LINE).not.toMatch(/colou?r|green|band/i);
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
