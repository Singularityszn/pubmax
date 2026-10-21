import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNightArchitectServer, type NightArchitectData } from "@/lib/chatgpt/server";

const venue = {
  id: "venue-test", name: "The Test Arms", area: "Camden",
  latitude: 51.54, longitude: -0.14,
  href: "https://pubmaxxing.com/map?venue=venue-test", prices: [], history: [],
};
const connections: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(connections.splice(0).map((connection) => connection.close())); });

async function connect(overrides: Partial<NightArchitectData> = {}) {
  const server = createNightArchitectServer({
    search: async () => [venue],
    detail: async (id) => id === venue.id ? venue : null,
    generate: async () => ({ grounded: true, stops: [], planningConfidence: null }),
    ...overrides,
  }, "<html>Map</html>");
  const client = new Client({ name: "pubmaxx-test", version: "1" });
  const [host, service] = InMemoryTransport.createLinkedPair();
  await server.connect(service);
  await client.connect(host);
  connections.push(client, server);
  return client;
}

describe("Night Architect MCP public tools", () => {
  it("discovers bounded anonymous tools and returns a map-backed search result", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "pubmaxx_search_venues", "pubmaxx_venue_details", "pubmaxx_plan_evening", "pubmaxx_replace_stop",
    ]);
    const result = await client.callTool({ name: "pubmaxx_search_venues", arguments: { query: "Camden" } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ area: "Camden", venues: [venue] });
    const resources = await client.listResources();
    const resource = await client.readResource({ uri: resources.resources[0]!.uri });
    expect(resource.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app", text: "<html>Map</html>" });
  });
});

it("rejects unexpected account fields and unknown pubs without exposing internals", async () => {
  const client = await connect();
  const invalid = await client.callTool({ name: "pubmaxx_search_venues", arguments: { query: "Camden", accountId: "private" } });
  expect(invalid.isError).toBe(true);
  const missing = await client.callTool({ name: "pubmaxx_venue_details", arguments: { venueId: "venue-missing" } });
  expect(missing).toMatchObject({ isError: true });
  expect(JSON.stringify(missing)).toContain("unavailable");
  const failedClient = await connect({ search: async () => { throw new Error("secret provider detail"); } });
  const failure = await failedClient.callTool({ name: "pubmaxx_search_venues", arguments: { query: "Camden" } });
  expect(JSON.stringify(failure)).not.toContain("secret provider detail");
});

const pubs = [
  { ...venue, id: "venue-one", prices: [{ drink: "Lager", priceGbp: 5, observedAt: "2026-10-01", status: "recorded" as const, publisher: null }] },
  { ...venue, id: "venue-two", longitude: -0.141 },
  { ...venue, id: "venue-three", longitude: -0.142 },
  { ...venue, id: "venue-four", longitude: -0.143, prices: [{ drink: "Lager", priceGbp: 7, observedAt: null, status: "estimate" as const, publisher: null }] },
];
async function planner() {
  return connect({
    detail: async (id) => pubs.find((pub) => pub.id === id) ?? null,
    generate: async () => ({ grounded: true, stops: [
      { venueId: "venue-one", estimatedPintPricePence: 500 },
      { venueId: "venue-two", estimatedPintPricePence: null },
      { venueId: "venue-three", estimatedPintPricePence: null },
    ], planningConfidence: { warnings: ["Opening times need checking."] } }),
  });
}
it("retains evidence gaps and never promises the full bill from a partial price total", async () => {
  const client = await planner();
  const result = await client.callTool({ name: "pubmaxx_plan_evening", arguments: { request: "Three pubs in Camden", budgetPence: 2000 } });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    venueIds: ["venue-one", "venue-two", "venue-three"],
    budget: { knownPence: 500, missingPrices: 2, limitPence: 2000, guaranteed: false },
    walking: { basis: "straight-line", withinLimitConfirmed: false },
    warnings: expect.arrayContaining(["Opening times need checking."]),
  });
});
it("replaces a stop using public records and recalculates the estimate without retaining old constraints", async () => {
  const client = await planner();
  const result = await client.callTool({ name: "pubmaxx_replace_stop", arguments: {
    venueIds: ["venue-one", "venue-two", "venue-three"], position: 2, replacementVenueId: "venue-four", drinkCategory: null, zeroProof: false,
  } });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    venueIds: ["venue-one", "venue-four", "venue-three"], routeChanged: true,
    budget: { knownPence: 1200, missingPrices: 1, guaranteed: false }, planningConfidence: null, stopEvidence: null,
    warnings: expect.arrayContaining(["The route changed. Opening hours, access and other preferences need checking again."]),
  });
  const duplicate = await client.callTool({ name: "pubmaxx_replace_stop", arguments: {
    venueIds: ["venue-one", "venue-two", "venue-three"], position: 2, replacementVenueId: "venue-one", drinkCategory: null, zeroProof: false,
  } });
  expect(duplicate.isError).toBe(true);
});
it("refuses known over-budget prices and routes beyond the walking limit", async () => {
  const client = await planner();
  const overBudget = await client.callTool({ name: "pubmaxx_replace_stop", arguments: {
    venueIds: ["venue-one", "venue-two", "venue-three"], position: 2, replacementVenueId: "venue-four", drinkCategory: null, zeroProof: false, budgetPence: 500,
  } });
  expect(overBudget.isError).toBe(true);
  const far = { ...pubs[2]!, latitude: 51.65 };
  const distant = await connect({ detail: async (id) => id === far.id ? far : pubs.find((pub) => pub.id === id) ?? null });
  const overWalk = await distant.callTool({ name: "pubmaxx_replace_stop", arguments: {
    venueIds: ["venue-one", "venue-two", "venue-three"], position: 2, replacementVenueId: "venue-four", drinkCategory: null, zeroProof: false, maxWalkingMinutes: 1,
  } });
  expect(overWalk.isError).toBe(true);
});
it("refuses unsupported generator results rather than filling gaps with invented stops", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "pubmaxx_plan_evening", arguments: { request: "Three pubs in Camden" } });
  expect(result.isError).toBe(true);
});

it("enforces the planner's street walking time when it exceeds the straight-line estimate", async () => {
  const client = await connect({
    detail: async (id) => pubs.find((pub) => pub.id === id) ?? null,
    generate: async () => ({ grounded: true, stops: pubs.slice(0, 3).map((pub) => ({ venueId: pub.id, estimatedPintPricePence: 500 })), routeTotals: { estimatedWalkingMinutes: 20, distanceBasis: "street" } }),
  });
  const result = await client.callTool({ name: "pubmaxx_plan_evening", arguments: { request: "Camden pubs", maxWalkingMinutes: 15 } });
  expect(result.isError).toBe(true);
});
it("does not replace alcohol-free route costs with beer prices", async () => {
  const client = await planner();
  const result = await client.callTool({ name: "pubmaxx_replace_stop", arguments: {
    venueIds: ["venue-one", "venue-two", "venue-three"], position: 2, replacementVenueId: "venue-four",
    drinkCategory: "soft-drink", zeroProof: true,
  } });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ budget: { knownPence: 0, missingPrices: 3 }, zeroProof: true });
});

const replacement = {
  venueIds: ["venue-one", "venue-two", "venue-three"], position: 2,
  replacementVenueId: "venue-four", drinkCategory: "beer", zeroProof: false, budgetPence: 2000,
};
it.each(["undated", "stale", "future", "unattributed", "missing", "modelled", "selected-drink"])("refuses a replacement ceiling with %s evidence", async (kind) => {
  const client = await connect({ detail: async (id) => ({
    ...venue, id,
    prices: kind === "missing" ? [] : [{
      drink: "Lager", priceGbp: 5,
      observedAt: kind === "undated" ? null : kind === "stale" ? "2020-01-01T12:00:00Z"
        : kind === "future" ? "2099-01-01T12:00:00Z" : new Date().toISOString(),
      status: "estimate", ...(kind === "modelled" ? { basis: "regional model" } : {}),
      publisher: kind === "unattributed" ? null : { label: "Menu", url: "https://pub.example/menu" },
    }],
  }) });
  const result = await client.callTool({ name: "pubmaxx_replace_stop", arguments: {
    ...replacement, ...(kind === "selected-drink" ? { drinkCategory: "wine" } : {}),
  } });
  expect(result.isError).toBe(true);
});
it.each([1, 2, 3])("checks the ceiling evidence at stop %i", async (position) => {
  const client = await connect({ detail: async (id) => ({
    ...venue, id,
    prices: [{ drink: "Lager", priceGbp: 5, observedAt: new Date().toISOString(), status: "recorded",
      publisher: id === ["venue-one", "venue-four", "venue-three"][position - 1] ? null : { label: "Menu", url: "https://pub.example/menu" },
    }],
  }) });
  expect((await client.callTool({ name: "pubmaxx_replace_stop", arguments: replacement })).isError).toBe(true);
});
it("uses the same attributable price for a replacement ceiling and its returned budget", async () => {
  const client = await connect({ detail: async (id) => ({
    ...venue, id,
    prices: [{ drink: "Lager", priceGbp: 6,
      observedAt: new Date(Date.now() - 20 * 86400_000).toISOString(), status: "recorded",
      publisher: { label: "Menu", url: "https://pub.example/menu" } }],
  }) });
  const result = await client.callTool({ name: "pubmaxx_replace_stop", arguments: replacement });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ budget: { knownPence: 1800, missingPrices: 0, limitPence: 2000, guaranteed: false } });
  expect((await client.callTool({ name: "pubmaxx_replace_stop", arguments: { ...replacement, budgetPence: 1700 } })).isError).toBe(true);
});
