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

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

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
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(body, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const { headAnchorSource } = await import("../scripts/verify_famous_venues.mjs");
    await expect(headAnchorSource(row.anchor.sourceUrl)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://wongkei.example/robots.txt");
  });

  it("asks robots before sending an allowed anchor HEAD without redirects", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) =>
      String(input).endsWith("/robots.txt")
        ? new Response("User-agent: *\nDisallow:\n", { status: 200 })
        : new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { headAnchorSource } = await import("../scripts/verify_famous_venues.mjs");
    await expect(headAnchorSource(row.anchor.sourceUrl)).resolves.toEqual({ status: 200, location: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://wongkei.example/robots.txt");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(row.anchor.sourceUrl);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "HEAD", redirect: "manual" });
  });

  it.each([403, 404, 429, 500, 503])("does not renew a row when its anchor HEAD answers HTTP %i", async (status) => {
    const { applyVerification, verifyRowWithPlaces } = await import("../scripts/verify_famous_venues.mjs");
    const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "famous_venues", "places", "operational_match.json"), "utf8"));
    const check = await verifyRowWithPlaces(row, async () => fixture, async () => ({ status, location: null }));
    expect(check).toMatchObject({ outcome: "unverified", result: "anchor_source_unreachable" });
    const packs = applyVerification(new Map([["late_food.json", [row]]]), [check], "2026-11-06");
    expect(packs.get("late_food.json")).toEqual([row]);
  });

  it.each([
    ["target robots deny", "https://www.wongkei.example/menu", "deny", 200, "unverified", "anchor_source_unreachable"],
    ["target returns 404", "https://www.wongkei.example/menu", "allow", 404, "unverified", "anchor_source_unreachable"],
    ["malformed location", "http://[", "allow", 200, "unverified", "anchor_source_redirected"],
    ["noncanonical target", "https://other.example/menu", "allow", 200, "unverified", "anchor_source_redirected"],
    ["permitted canonical target", "https://www.wongkei.example/menu", "allow", 200, "confirmed", "places_operational"],
  ] as const)("checks %s before renewal", async (_label, location, targetPolicy, targetStatus, outcome, result) => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/robots.txt") {
        const rules = url.hostname.startsWith("www.") && targetPolicy === "deny"
          ? "User-agent: *\nDisallow: /menu\n" : "User-agent: *\nDisallow:\n";
        return new Response(rules, { status: 200 });
      }
      expect(init).toMatchObject({ method: "HEAD", redirect: "manual" });
      if (url.hostname === "wongkei.example") return new Response(null, { status: 301, headers: { location } });
      return new Response(null, { status: targetStatus });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { applyVerification, headAnchorSource, verifyRowWithPlaces } = await import("../scripts/verify_famous_venues.mjs");
    const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "famous_venues", "places", "operational_match.json"), "utf8"));
    const check = await verifyRowWithPlaces(row, async () => fixture, headAnchorSource);
    expect(check).toMatchObject({ outcome, result });
    const calls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(calls.slice(0, 2)).toEqual(["https://wongkei.example/robots.txt", row.anchor.sourceUrl]);
    if (location.startsWith("https://www.")) {
      expect(calls[2]).toBe("https://www.wongkei.example/robots.txt");
      if (targetPolicy === "deny") expect(calls).toHaveLength(3);
      else expect(calls).toEqual([...calls.slice(0, 3), location]);
    } else expect(calls).toHaveLength(2);
    const packs = applyVerification(new Map([["late_food.json", [row]]]), [check], "2026-11-06");
    if (outcome === "confirmed") expect(packs.get("late_food.json")?.[0].observedAt).toBe("2026-11-06");
    else expect(packs.get("late_food.json")).toEqual([row]);
  });
});
