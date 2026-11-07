import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import recorded from "@/e2e/fixtures/soho-walk-route.json";
import type { PubComparisonResponse } from "@/lib/pubComparison";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (original) => ({
  ...await original<typeof import("@/lib/supabase")>(), isSupabaseConfigured: () => false,
}));
// The recorded route starts at The Lyric. Use that public point in this test's
// meeting-point catalogue, without claiming it is a production landmark.
vi.mock("@/lib/landmarks", () => ({ landmarks: [
  { id: "recorded-soho-start", name: "Recorded Soho start", coordinates: [-0.134383, 51.5113] },
] }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => ({
  user: null, handle: null, accountRevision: 0, providerAuthState: "signed-out",
}) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/venueIndex", () => ({ lookupCanonicalVenue: async (id: string) => ({
  status: "found", canonicalId: id, slimVenue: {}, venue: {
    id, name: id === "venue-122cuu1" ? "The Queen's Head" : "The Devonshire",
    kind: "pub", borough: "Westminster", lat: id === "venue-122cuu1" ? 51.5108 : 51.5106,
    lng: id === "venue-122cuu1" ? -0.135402 : -0.135301,
  },
}) }));
vi.mock("@/lib/pintPriceLandingDataset.server", () => ({ loadPintPriceLandingVenuesOrThrow: async () => [
  { id: "venue-122cuu1", name: "The Queen's Head", kind: "pub", address: "15 Denman Street", prices: [
    { pint_name: "Guinness", price_gbp: 7, pub_url: "https://example.org/queen", scraped_at_values: "2026-10-26" },
  ] },
  { id: "venue-s2ppfm", name: "The Devonshire", kind: "pub", address: "17 Denman Street", prices: [
    { pint_name: "Guinness", price_gbp: 5, pub_url: "https://example.org/devonshire", scraped_at_values: "2026-10-26" },
  ] },
] }));
vi.mock("@/lib/ukPriceBundle.server", () => ({ ukPriceBundleRowsByVenue: async () => ({ status: "ready", byVenue: new Map() }) }));

import { POST } from "@/app/api/pub-comparison/route";
import PubComparisonResults from "@/components/tools/PubComparisonResults";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetWalkRouteStore } from "@/lib/walkRouteStore";
import { ORS_FOOT_WALKING_URL } from "@/lib/walkRouteProvider";
import { __resetOrsBudget } from "@/lib/walkRouteBudget";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
  vi.stubEnv("ORS_API_KEY", "recorded-response-only");
  __resetPintDrops();
  __resetWalkRouteStore();
  __resetOrsBudget();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  __resetWalkRouteStore();
  __resetOrsBudget();
});

it("renders recorded routed walks and the price-versus-walk difference, then reuses the cache", async () => {
  // Oracle: the recorded response's legs measure 119 m and 37 m. At the
  // documented 4.8 km/h pace these round to 1 minute and 2 minutes cumulative.
  // Test prices are £7 and £5 for one pint. A straight-line shortcut, missing
  // route, provider-duration substitution, or reversed saving fails this test.
  const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe(ORS_FOOT_WALKING_URL);
    const { coordinates } = JSON.parse(String(init?.body));
    expect(coordinates[0]).toEqual([-0.134383, 51.5113]);
    expect([[-0.135402, 51.5108], [-0.135301, 51.5106]]).toContainEqual(coordinates[1]);
    const full = recorded.line.features[0]!.geometry.coordinates;
    const geometry = coordinates[1][1] === 51.5108 ? full.slice(0, 11) : full;
    // Replay the recorded LineString through the real provider decoder. The
    // summary is deliberately incompatible with the shared walking pace.
    return Response.json({ type: "FeatureCollection", features: [{ type: "Feature",
      geometry: { type: "LineString", coordinates: geometry }, properties: { summary: { duration: 7200 } },
    }] });
  });
  vi.stubGlobal("fetch", network);
  const compare = () => POST(new Request("http://localhost/api/pub-comparison", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      venueIds: ["venue-122cuu1", "venue-s2ppfm"], meetingPointId: "recorded-soho-start",
      order: [{ category: "beer", drinkLabel: "Guinness", serving: "pint", quantity: 1 }],
    }),
  }));
  const response = await compare();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const result = await response.json() as PubComparisonResponse;
  expect(result.completeVenueCount).toBe(2);
  expect(result.venues.map(({ totalPence, walk }) => ({ totalPence, walk }))).toEqual([
    { totalPence: 700, walk: { status: "routed", minutes: 1, method: "ors", timing: "shared-walking-pace" } },
    { totalPence: 500, walk: { status: "routed", minutes: 2, method: "ors", timing: "shared-walking-pace" } },
  ]);
  const html = renderToStaticMarkup(createElement(PubComparisonResults, { result }));
  expect(html).toContain("1 minutes on a walking route.");
  expect(html).toContain("2 minutes on a walking route.");
  expect(html).toContain("£2.00 less, and 1 minutes more walking.");
  expect(html).not.toContain("walking comparison is unavailable");
  expect(network).toHaveBeenCalledTimes(2);

  vi.stubEnv("ORS_API_KEY", "");
  network.mockRejectedValue(new Error("A cached comparison must not use the provider"));
  const cached = await compare();
  expect(cached.status).toBe(200);
  expect(await cached.json()).toEqual(result);
  expect(network).toHaveBeenCalledTimes(2);
});
