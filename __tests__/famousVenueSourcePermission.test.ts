import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const row = {
  id: "food-wong-kei",
  name: "Wong Kei",
  address: "41-43 Wardour Street, London W1D 6PY",
  borough: "Westminster",
  lat: 51.51173,
  lng: -0.13265,
  sourceUrl: "https://wongkei.example/",
  anchor: { sourceUrl: "https://wongkei.example/menu" },
  observedAt: "2026-10-01",
  expiresAt: "2026-10-31",
};

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("famous venue anchor permission", () => {
  it("refuses a private-network anchor before asking robots or the page", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { headAnchorSource } = await import("../scripts/verify_famous_venues.mjs");
    await expect(headAnchorSource("http://127.0.0.1/menu")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["disallowed path", 200, "User-agent: *\nDisallow: /menu\n"],
    ["robots refusal", 403, "Forbidden"],
    ["robots rate limit", 429, "Too many requests"],
  ] as const)("does not request the anchor after %s", async (_label, status, body) => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(body, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const { headAnchorSource } = await import("../scripts/verify_famous_venues.mjs");
    await expect(headAnchorSource(row.anchor.sourceUrl)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://wongkei.example/robots.txt");
  });

  it("asks robots before sending an allowed anchor HEAD without redirects", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, ..._rest: unknown[]) =>
      String(input).endsWith("/robots.txt")
        ? new Response("User-agent: *\nDisallow:\n", { status: 200 })
        : new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { headAnchorSource } = await import("../scripts/verify_famous_venues.mjs");
    await expect(headAnchorSource(row.anchor.sourceUrl)).resolves.toEqual({ status: 200, location: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://wongkei.example/robots.txt");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(row.anchor.sourceUrl);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "HEAD", redirect: "manual" });
  });

  it.each([403, 404, 429, 500, 503])("preserves renewal when its permitted anchor HEAD answers HTTP %i", async (status) => {
    const { applyVerification, verifyRowWithPlaces } = await import("../scripts/verify_famous_venues.mjs");
    const fixture = JSON.parse(
      readFileSync(path.join(__dirname, "fixtures", "famous_venues", "places", "operational_match.json"), "utf8"),
    );
    const check = await verifyRowWithPlaces(row, async () => fixture, async () => ({ status, location: null }));
    expect(check).toMatchObject({ outcome: "confirmed", result: "places_operational" });
    const packs = applyVerification(new Map([["late_food.json", [row]]]), [check], "2026-11-06");
    expect(packs.get("late_food.json")?.[0]).toMatchObject({
      observedAt: "2026-11-06",
      expiresAt: "2026-12-06",
    });
  });

  it.each([
    ["missing location", null, "unverified", "anchor_source_redirected"],
    ["malformed location", "http://[", "unverified", "anchor_source_redirected"],
    ["noncanonical target", "https://other.example/menu", "unverified", "anchor_source_redirected"],
    ["private target", "http://127.0.0.1/menu", "unverified", "anchor_source_redirected"],
    ["www target", "https://www.wongkei.example/menu", "confirmed", "places_operational"],
    ["relative trailing slash", "/menu/", "confirmed", "places_operational"],
  ] as const)("classifies %s without requesting the target", async (_label, location, outcome, result) => {
    const fetchMock = vi.fn(async (input: string | URL | Request, ..._rest: unknown[]) => {
      if (String(input) === "https://wongkei.example/robots.txt") {
        return new Response("User-agent: *\nDisallow:\n", { status: 200 });
      }
      return new Response(null, { status: 301, headers: location === null ? {} : { location } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { applyVerification, headAnchorSource, verifyRowWithPlaces } = await import(
      "../scripts/verify_famous_venues.mjs",
    );
    const fixture = JSON.parse(
      readFileSync(path.join(__dirname, "fixtures", "famous_venues", "places", "operational_match.json"), "utf8"),
    );
    const check = await verifyRowWithPlaces(row, async () => fixture, headAnchorSource);
    expect(check).toMatchObject({ outcome, result });
    const calls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(calls).toEqual(["https://wongkei.example/robots.txt", row.anchor.sourceUrl]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "HEAD", redirect: "manual" });
    const packs = applyVerification(new Map([["late_food.json", [row]]]), [check], "2026-11-06");
    const stamped = packs.get("late_food.json")?.[0];
    if (outcome === "confirmed") expect(stamped?.observedAt).toBe("2026-11-06");
    else expect(packs.get("late_food.json")).toEqual([row]);
  });
});
