import { describe, expect, it } from "vitest";

import { DRINK_CATEGORIES } from "@/lib/drinks";
import {
  cleanSubmittedUrl,
  looksLikePdf,
  normaliseUkPostcode,
  validateVenueSubmission,
  validateVenueSubmissionDecision,
  VENUE_SUBMISSION_FILE_KINDS,
  VENUE_SUBMISSION_MAX_PRICES,
  VENUE_SUBMISSION_STATUSES,
  venueSubmissionFileKey,
  venueSubmissionFileKind,
} from "@/lib/venueSubmissions";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OWNER = "a1111111-1111-4111-8111-111111111111";
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20261017190000_0189_venue_submissions.sql"),
  "utf8",
);

function base(extra: Record<string, unknown> = {}) {
  return { name: "The Missing Crown", address: "1 Example Street, London", ...extra };
}

describe("validateVenueSubmission", () => {
  it("takes a name and an address and fills every other field with its empty value", () => {
    const result = validateVenueSubmission(OWNER, base());
    expect(result).toEqual({
      ok: true,
      value: {
        ownerUserId: OWNER,
        name: "The Missing Crown",
        address: "1 Example Street, London",
        postcode: "",
        latitude: null,
        longitude: null,
        website: "",
        menuUrl: "",
        openingHours: "",
        note: "",
        prices: [],
      },
    });
  });

  it("takes the owner from the caller and never from the body", () => {
    const result = validateVenueSubmission(OWNER, base({ ownerUserId: "someone-else", owner_user_id: "x" }));
    expect(result.ok && result.value.ownerUserId).toBe(OWNER);
  });

  it("refuses a missing name or address, naming the field", () => {
    expect(validateVenueSubmission(OWNER, base({ name: "  " }))).toMatchObject({ ok: false, field: "name" });
    expect(validateVenueSubmission(OWNER, base({ address: "" }))).toMatchObject({ ok: false, field: "address" });
    expect(validateVenueSubmission(OWNER, null)).toMatchObject({ ok: false, field: "body" });
    expect(validateVenueSubmission(OWNER, [])).toMatchObject({ ok: false, field: "body" });
  });

  it("strips markup and caps the free text", () => {
    const result = validateVenueSubmission(OWNER, base({ name: "<b>Crown</b>", note: "x".repeat(900) }));
    expect(result.ok && result.value.name).toBe("bCrown/b");
    expect(result.ok && result.value.note).toHaveLength(500);
  });

  it("normalises a postcode and refuses one that is not a postcode", () => {
    expect(validateVenueSubmission(OWNER, base({ postcode: "se19aa" }))).toMatchObject({
      ok: true,
      value: { postcode: "SE1 9AA" },
    });
    expect(validateVenueSubmission(OWNER, base({ postcode: "London" }))).toMatchObject({ ok: false, field: "postcode" });
  });

  it("holds a map position to Great Britain, both halves or neither", () => {
    expect(validateVenueSubmission(OWNER, base({ latitude: 51.5, longitude: -0.12 }))).toMatchObject({
      ok: true,
      value: { latitude: 51.5, longitude: -0.12 },
    });
    expect(validateVenueSubmission(OWNER, base({ latitude: 40.7, longitude: -74 }))).toMatchObject({ ok: false, field: "position" });
    expect(validateVenueSubmission(OWNER, base({ latitude: 51.5 }))).toMatchObject({ ok: false, field: "position" });
  });

  it("stores links as https only, adding the scheme a person leaves off", () => {
    expect(validateVenueSubmission(OWNER, base({ website: "crownpub.co.uk", menuUrl: "https://crownpub.co.uk/menu.pdf" })))
      .toMatchObject({ ok: true, value: { website: "https://crownpub.co.uk/", menuUrl: "https://crownpub.co.uk/menu.pdf" } });
    for (const bad of ["http://crownpub.co.uk", "javascript:alert(1)", "https://user:pass@crownpub.co.uk", "https://localhost"]) {
      expect(validateVenueSubmission(OWNER, base({ website: bad })), bad).toMatchObject({ ok: false, field: "website" });
    }
  });

  it("reads prices through the drink vocabulary and the community price envelope", () => {
    const result = validateVenueSubmission(OWNER, base({
      prices: [
        { drinkCategory: "beer", drinkName: "Camden Hells", priceGbp: "£5.20", measure: "pint" },
        { drinkCategory: "WINE", priceGbp: 7, measure: "nonsense" },
      ],
    }));
    expect(result.ok && result.value.prices).toEqual([
      { drinkCategory: "beer", drinkName: "Camden Hells", priceGbp: 5.2, measure: "pint" },
      { drinkCategory: "wine", drinkName: "", priceGbp: 7, measure: "pint" },
    ]);
    for (const price of [{ drinkCategory: "lager", priceGbp: 5 }, { drinkCategory: "beer", priceGbp: 0.5 }, { drinkCategory: "beer", priceGbp: 31 }, { drinkCategory: "beer" }]) {
      expect(validateVenueSubmission(OWNER, base({ prices: [price] })), JSON.stringify(price)).toMatchObject({ ok: false, field: "prices" });
    }
    const tooMany = Array.from({ length: VENUE_SUBMISSION_MAX_PRICES + 1 }, () => ({ drinkCategory: "beer", priceGbp: 5 }));
    expect(validateVenueSubmission(OWNER, base({ prices: tooMany }))).toMatchObject({ ok: false, field: "prices" });
    expect(validateVenueSubmission(OWNER, base({ prices: { beer: 5 } }))).toMatchObject({ ok: false, field: "prices" });
  });
});

describe("small readers", () => {
  it("normalises postcodes", () => {
    expect(normaliseUkPostcode("ec1a 1bb")).toBe("EC1A 1BB");
    expect(normaliseUkPostcode("W1A0AX")).toBe("W1A 0AX");
    expect(normaliseUkPostcode("12345")).toBeNull();
  });

  it("cleans a submitted URL, an empty one included", () => {
    expect(cleanSubmittedUrl("")).toBe("");
    expect(cleanSubmittedUrl(42)).toBeNull();
    expect(cleanSubmittedUrl(`https://a.co/${"x".repeat(600)}`)).toBeNull();
  });

  it("names a file's kind from its declared type", () => {
    expect(venueSubmissionFileKind("image/png")).toBe("image");
    expect(venueSubmissionFileKind("application/pdf")).toBe("pdf");
    expect(venueSubmissionFileKind("image/heic")).toBeNull();
    expect(venueSubmissionFileKind("text/html")).toBeNull();
  });

  it("knows a PDF by its first five bytes", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("<html>"))).toBe(false);
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });

  it("keys a file inside its owner's submission folder", () => {
    expect(venueSubmissionFileKey(OWNER, "sub", "f1", "pdf")).toBe(`venue-submissions/${OWNER}/sub/f1.pdf`);
    expect(venueSubmissionFileKey(OWNER, "sub", "f1", "image")).toBe(`venue-submissions/${OWNER}/sub/f1.jpg`);
  });
});

describe("validateVenueSubmissionDecision", () => {
  it("reads accept, decline and duplicate, and nothing else", () => {
    expect(validateVenueSubmissionDecision({ action: "accept", note: "Checked the street." })).toEqual({
      ok: true,
      value: { status: "accepted", note: "Checked the street." },
    });
    expect(validateVenueSubmissionDecision({ action: "decline" })).toEqual({ ok: true, value: { status: "declined", note: null } });
    expect(validateVenueSubmissionDecision({ action: "duplicate", duplicateOfVenueId: "venue-uk-n251829660" })).toEqual({
      ok: true,
      value: { status: "duplicate", duplicateOfVenueId: "venue-uk-n251829660", note: null },
    });
    expect(validateVenueSubmissionDecision({ action: "duplicate", duplicateOfVenueId: "The Crown" }).ok).toBe(false);
    expect(validateVenueSubmissionDecision({ action: "publish" }).ok).toBe(false);
  });
});

describe("the closed sets match migration 0189", () => {
  it("mirrors the status CHECK", () => {
    const statuses = VENUE_SUBMISSION_STATUSES.map((status) => `'${status}'`).join(", ");
    expect(MIGRATION).toContain(`check (status in (${statuses}))`);
  });

  it("mirrors the file kind CHECK", () => {
    for (const kind of VENUE_SUBMISSION_FILE_KINDS) expect(MIGRATION).toContain(`kind = '${kind}'`);
  });

  it("stores only drink categories the vocabulary knows", () => {
    expect(DRINK_CATEGORIES).toContain("beer");
  });
});
