import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  runVerification,
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

describe("famous verifier permission before paid dispatch", () => {
  let root: string;
  let famous: string;
  let receipt: string;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Live fetch denied"); }));
    root = mkdtempSync(path.join(tmpdir(), "pubmax-famous-source-mock-"));
    famous = path.join(root, "data", "famous_venues");
    mkdirSync(famous, { recursive: true });
    receipt = path.join(root, "spent.json");
    writeFileSync(receipt, JSON.stringify({ placesCalls: 98, maxPlacesCalls: 100 }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); rmSync(root, { recursive: true, force: true }); });
  const writeRows = (rows = [sampleRow]) => {
    for (const file of ["bars.json", "late_food.json", "restaurants.json"]) {
      writeFileSync(path.join(famous, file), JSON.stringify(file === "bars.json" ? rows : []));
    }
  };
  const run = (fetchImpl: typeof fetch, ids = sampleRow.id) => runVerification({
    argv: ["--write", "--ids", ids, "--spent-receipt", receipt], root,
    stateRoot: path.join(root, "state"), apiKey: "fake-key", fetchImpl,
    now: () => new Date("2026-10-21T12:00:00Z"),
  });
  const check = () => JSON.parse(readFileSync(path.join(famous, "bars.json"), "utf8"))[0];

  it.each([403, 404, 503])("withholds an HTTP %s anchor before Places and keeps the row unchanged", async (status) => {
    writeRows();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/robots.txt")
      ? new Response("User-agent: *\nAllow: /\n") : new Response(null, { status }));
    await run(fetchImpl);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("places.googleapis.com"))).toBe(false);
    expect(check()).toEqual(sampleRow);
  });

  it("refuses a sourcePolicy URL before any request", async () => {
    writeRows([{ ...sampleRow, sourceUrl: "http://127.0.0.1/", anchor: { sourceUrl: "http://127.0.0.1/menu" } }]);
    const fetchImpl = vi.fn();
    await run(fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["User-agent: *\nDisallow: /\n", "<html>Just a moment</html>"])("refuses robots denial or challenge before the anchor", async (body) => {
    writeRows();
    const fetchImpl = vi.fn(async () => new Response(body));
    await run(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(check()).toEqual(sampleRow);
  });

  it("accepts absent robots and follows only a canonical anchor redirect", async () => {
    writeRows();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/robots.txt")) return new Response(null, { status: 404 });
      if (value.includes("places.googleapis.com")) return Response.json(loadFixture("operational_match.json").body);
      return value.endsWith("/menu") ? new Response(null, { status: 301, headers: { location: "/menu/" } }) : new Response(null);
    });
    await run(fetchImpl);
    expect(check().observedAt).toBe("2026-10-21");
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("places.googleapis.com"))).toHaveLength(1);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("/menu"))).toHaveLength(2);
  });

  it("refuses a cross-operator robots redirect without requesting its target", async () => {
    writeRows();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://another.example/robots.txt" } }));
    await run(fetchImpl);
    expect(fetchImpl.mock.calls.every(([url]) => !String(url).includes("another.example"))).toBe(true);
    expect(check()).toEqual(sampleRow);
  });

  it("keeps a 429 terminal even when the robots checker catches and retries it", async () => {
    writeRows();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 429 }));
    await expect(run(fetchImpl)).rejects.toThrow(/429|halt/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses the 127th source dispatch even through a swallowed robots failure", async () => {
    const rows = Array.from({ length: 64 }, (_, index) => ({
      ...sampleRow, id: `row-${String(index).padStart(2, "0")}`,
      sourceUrl: `https://venue-${index}.example/`, anchor: { sourceUrl: `https://venue-${index}.example/menu` },
    }));
    writeRows(rows);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/robots.txt")
      ? new Response("User-agent: *\nAllow: /\n") : new Response(null, { status: 403 }));
    await expect(run(fetchImpl, rows.map((row) => row.id).join(","))).rejects.toThrow(/source.*budget|halt/);
    expect(fetchImpl).toHaveBeenCalledTimes(126);
  });

  it("bounds robots streams before the existing checker can read them", async () => {
    writeRows();
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(512 * 1024 + 1)));
    await run(fetchImpl);
    expect(fetchImpl.mock.calls.every(([url]) => String(url).endsWith("/robots.txt"))).toBe(true);
    expect(check()).toEqual(sampleRow);
  });

  it("times out source requests and preserves the existing single unreachable retry", async () => {
    writeRows();
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("fixture aborted")), { once: true });
    }));
    const result = run(fetchImpl);
    await vi.advanceTimersByTimeAsync(32_000);
    await result;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(([url]) => String(url).endsWith("/robots.txt"))).toBe(true);
    expect(check()).toEqual(sampleRow);
  });
});
