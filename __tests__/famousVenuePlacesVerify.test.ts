import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  decidePlacesVerification,
  evaluateLocationMatch,
  evaluateNameMatch,
} from "@/scripts/lib/famousVenuePlacesMatch.mjs";
import { placesFromSearchPayload } from "@/scripts/lib/googlePlacesTextSearch.mjs";
import {
  placesCheckAllowsSeedMutation,
  verifyRowWithPlaces,
} from "@/scripts/verify_famous_venues.mjs";

const FIXTURES = path.join(__dirname, "fixtures", "famous_venues", "places");

function loadFixture(name: string) {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
}

const sampleRow = {
  id: "food-wong-kei",
  name: "Wong Kei",
  address: "41-43 Wardour Street, London W1D 6PY",
  borough: "Westminster",
  lat: 51.51173,
  lng: -0.13265,
  sourceUrl: "https://example.com/",
};

describe("famous venue Places match rules", () => {
  it("accepts an operational match when name and postcode align", () => {
    const payload = loadFixture("operational_match.json");
    const places = placesFromSearchPayload(payload);
    const decision = decidePlacesVerification(sampleRow, places);
    expect(decision.outcome).toBe("confirmed");
    expect(decision.result).toBe("places_operational");
    expect(decision.evidence?.businessStatus).toBe("OPERATIONAL");
  });

  it("drops a permanently closed confident match", () => {
    const payload = loadFixture("permanently_closed.json");
    const decision = decidePlacesVerification(
      sampleRow,
      placesFromSearchPayload(payload),
    );
    expect(decision.outcome).toBe("closed");
    expect(decision.result).toBe("places_closed_permanently");
  });

  it("withholds a temporarily closed confident match", () => {
    const payload = loadFixture("temporarily_closed.json");
    const decision = decidePlacesVerification(
      sampleRow,
      placesFromSearchPayload(payload),
    );
    expect(decision.outcome).toBe("unverified");
    expect(decision.result).toBe("places_closed_temporarily");
  });

  it("does not confirm a parent listing via substring name match", () => {
    const row = {
      ...sampleRow,
      id: "bar-american-bar-savoy",
      name: "American Bar at The Savoy",
      address: "Strand, London WC2R 0EZ",
    };
    const place = {
      displayName: { text: "The Savoy" },
      formattedAddress: "Strand, London WC2R 0EZ, UK",
      businessStatus: "OPERATIONAL",
      location: { latitude: 51.51009, longitude: -0.12085 },
    };
    expect(evaluateNameMatch(row.name, "The Savoy").match).toBe(false);
    const decision = decidePlacesVerification(row, [place]);
    expect(decision.outcome).toBe("unverified");
  });

  it("confirms via an explicit placesNameAliases entry", () => {
    const row = {
      ...sampleRow,
      id: "bar-american-bar-savoy",
      name: "American Bar at The Savoy",
      address: "Strand, London WC2R 0EZ",
      placesNameAliases: ["American Bar"],
    };
    const place = {
      displayName: { text: "American Bar" },
      formattedAddress: "Strand, London WC2R 0EZ, UK",
      businessStatus: "OPERATIONAL",
      location: { latitude: 51.51009, longitude: -0.12085 },
    };
    const decision = decidePlacesVerification(row, [place]);
    expect(decision.outcome).toBe("confirmed");
  });

  it("does not match nested postcodes (E1 vs SE1)", () => {
    const row = { address: "1 Example Street, London E1 6GQ" };
    const place = { formattedAddress: "Other Rd, London SE1 6GQ, UK" };
    expect(evaluateLocationMatch(row, place).match).toBe(false);
  });

  it("withholds when the returned name does not match", () => {
    const payload = loadFixture("name_mismatch.json");
    const decision = decidePlacesVerification(
      sampleRow,
      placesFromSearchPayload(payload),
    );
    expect(decision.outcome).toBe("unverified");
    expect(decision.result).toBe("places_no_confident_match");
    expect(evaluateNameMatch(sampleRow.name, "Random Cafe").match).toBe(false);
  });

  it("withholds when the only match is too far from recorded coordinates", () => {
    const payload = loadFixture("far_away_match.json");
    const place = placesFromSearchPayload(payload)[0];
    const location = evaluateLocationMatch(sampleRow, place as { formattedAddress?: string; location?: { latitude: number; longitude: number } });
    expect(location.match).toBe(false);
    const decision = decidePlacesVerification(sampleRow, [place]);
    expect(decision.outcome).toBe("unverified");
  });

  it("withholds when Places returns no results", () => {
    const payload = loadFixture("missing_result.json");
    const decision = decidePlacesVerification(
      sampleRow,
      placesFromSearchPayload(payload),
    );
    expect(decision.outcome).toBe("unverified");
    expect(decision.result).toBe("places_no_result");
  });
});

describe("verifyRowWithPlaces", () => {
  it("maps a cached fixture through the verifier row shape", async () => {
    const payload = loadFixture("operational_match.json");
    const check = await verifyRowWithPlaces(sampleRow, async () => payload);
    expect(check.outcome).toBe("confirmed");
    expect(check.method).toBe("places_text_search");
    expect(check.placeId).toMatch(/^places\//);
  });
});

describe("verifyRowWithPlaces error labels", () => {
  it("labels a non-2xx Places response as places_http_error", async () => {
    const check = await verifyRowWithPlaces(sampleRow, async () => ({
      httpStatus: 429,
      body: { error: { status: "RESOURCE_EXHAUSTED" } },
      fetchedAt: "2026-09-24T12:00:00.000Z",
      fromCache: false,
    }));
    expect(check.result).toBe("places_http_error");
    expect(check.matchReason).toBe("http_429");
  });

  it("labels a cache-only miss as places_cache_miss", async () => {
    const check = await verifyRowWithPlaces(sampleRow, async () => ({
      cacheMiss: true,
      fromCache: true,
      body: {},
    }));
    expect(check.result).toBe("places_cache_miss");
  });
});

describe("places seed mutation policy", () => {
  it("allows seed stamps only for live Places evidence on the verified day", () => {
    const verifiedDay = "2026-09-24";
    expect(
      placesCheckAllowsSeedMutation(
        {
          outcome: "confirmed",
          evidenceFromLiveCall: true,
          evidenceFetchedAt: "2026-09-24T12:00:00.000Z",
        },
        verifiedDay,
      ),
    ).toBe(true);
    expect(
      placesCheckAllowsSeedMutation(
        {
          outcome: "confirmed",
          evidenceFromLiveCall: false,
          evidenceFetchedAt: "2026-09-24T12:00:00.000Z",
        },
        verifiedDay,
      ),
    ).toBe(false);
  });
});
