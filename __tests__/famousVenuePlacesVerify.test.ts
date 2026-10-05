import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  decidePlacesVerification,
  evaluateLocationMatch,
  evaluateNameMatch,
} from "@/scripts/lib/famousVenuePlacesMatch.mjs";
import {
  createPlacesTextSearchClient,
  placesFromSearchPayload,
} from "@/scripts/lib/googlePlacesTextSearch.mjs";
import {
  toCommittedPlacesCheck,
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
  anchor: { sourceUrl: "https://example.com/menu" },
};

const liveAnchor = async () => ({ status: 200, location: null });

describe("famous venue Places match rules", () => {
  it("accepts an operational match when name and postcode align", () => {
    const payload = loadFixture("operational_match.json");
    const places = placesFromSearchPayload(payload);
    const decision = decidePlacesVerification(sampleRow, places);
    expect(decision.outcome).toBe("confirmed");
    expect(decision.result).toBe("places_operational");
    expect(decision.evidence.placeId).toMatch(/^places\//);
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
      placesNameAliases: ["american bar"],
    };
    const place = {
      displayName: { text: "AMERICAN BAR" },
      formattedAddress: "Strand, London WC2R 0EZ, UK",
      businessStatus: "OPERATIONAL",
      location: { latitude: 51.51009, longitude: -0.12085 },
    };
    const decision = decidePlacesVerification(row, [place]);
    expect(decision.outcome).toBe("confirmed");
  });

  it("matches names across diacritics and a leading article", () => {
    expect(evaluateNameMatch("The River Cafe", "The River Café").match).toBe(true);
    expect(evaluateNameMatch("Brasserie Zédel", "Brasserie Zedel").match).toBe(true);
    expect(evaluateNameMatch("Connaught Bar", "The Connaught Bar").match).toBe(true);
    expect(evaluateNameMatch("Eve Bar", "Eve Bar Covent Garden").match).toBe(false);
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
  it("maps a Places fixture through the verifier row shape", async () => {
    const payload = loadFixture("operational_match.json");
    const check = await verifyRowWithPlaces(sampleRow, async () => payload, liveAnchor);
    expect(check.outcome).toBe("confirmed");
    expect(check.method).toBe("places_text_search");
    expect(check.placeId).toMatch(/^places\//);
  });
});

describe("verifyRowWithPlaces failed call", () => {
  it("aborts on a non-2xx Places response instead of recording a verdict", async () => {
    await expect(
      verifyRowWithPlaces(
        sampleRow,
        async () => ({
          httpStatus: 429,
          body: { error: { status: "RESOURCE_EXHAUSTED" } },
          fetchedAt: "2026-09-24T12:00:00.000Z",
        }),
        liveAnchor,
      ),
    ).rejects.toThrow("Places Text Search failed for food-wong-kei: HTTP 429");
  });
});

describe("committed Places artifact", () => {
  it("keeps the place id and derived verdict, never Google addresses or statuses", async () => {
    const payload = {
      ...loadFixture("operational_match.json"),
      fetchedAt: "2026-09-25T10:00:00.000Z",
    };
    const committed = toCommittedPlacesCheck(
      await verifyRowWithPlaces(sampleRow, async () => payload, liveAnchor),
    );
    expect(Object.keys(committed).sort()).toEqual([
      "checkedAt",
      "id",
      "matchReason",
      "method",
      "outcome",
      "placeId",
      "result",
      "sourceUrl",
      "textQuery",
    ]);
    const place = placesFromSearchPayload(payload)[0] as {
      formattedAddress: string;
      businessStatus: string;
    };
    const serialized = JSON.stringify(committed);
    expect(serialized).not.toContain(place.formattedAddress);
    expect(serialized).not.toContain(place.businessStatus);
    expect(committed.checkedAt).toBe("2026-09-25T10:00:00.000Z");
  });
});

describe("Places Text Search client", () => {
  it("stops before exceeding the live call budget", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ places: [] }));
    const client = createPlacesTextSearchClient({
      apiKey: "test-key",
      maxLiveCalls: 1,
      fetchImpl,
    });
    await expect(client.searchText("Wong Kei W1D 6PY London")).resolves.toMatchObject({
      httpStatus: 200,
      body: { places: [] },
    });
    await expect(client.searchText("Rules WC2E 7LB London")).rejects.toThrow(
      /budget exhausted/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(client.getLiveCallCount()).toBe(1);
  });
});
