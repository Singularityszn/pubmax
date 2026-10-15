import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runAsk } from "@/lib/ask/runAsk";
import { runPalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";
import { resetCityStatusCache, resetJourneyCache } from "@/lib/citymcp/client";
import { __resetCommunityPrices } from "@/lib/communityPriceStore";
import { __resetPubPalToolTurnStore, readOwnedPubPalToolTurn } from "@/lib/pubPalToolTurnStore";
import * as priceUpdates from "@/lib/priceUpdates.server";
import { parseDrinkPriceUpdates } from "@/lib/drinkPriceUpdates";

const wineQuery = "Wine prices at Fox and Anchor and are there Tube delays?";
const menuQuery = "Price of Organic Pinot Grigio at Sherlock Holmes and directions to Sherlock Holmes from Kings Cross";
const menuSource = { label: "Disposable Sherlock menu", licence: "Test only", url: "https://example.com/sherlock-menu" };

beforeEach(() => {
  for (const key of ["OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
    vi.stubEnv(key, "");
  }
  vi.stubEnv("ELEVENLABS_API_KEY", "offline-test-key");
  vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "offline-agent");
  __resetCommunityPrices();
  __resetPubPalToolTurnStore();
  resetCityStatusCache();
  resetJourneyCache();
});

afterEach(() => {
  resetCityStatusCache();
  resetJourneyCache();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each((["ask", "configured chat"] as const).flatMap((boundary) => [
  { boundary, query: wineQuery, emptyAnswer: "No people-logged wine prices recorded at Fox and Anchor yet.", detail: "No accepted published drink prices match this category.", venueId: "venue-phg4ss" },
  { boundary, query: "Price of Unicorn stew at The New Inn and are there Tube delays?", emptyAnswer: "No accepted menu item matches that request at The New Inn.", detail: "Availability is unknown.", venueId: "venue-17qpap6" },
]))("retains a substantive empty answer beside successful transit through $boundary: $query", async ({ boundary, query, emptyAnswer, detail, venueId }) => {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    expect(String(input)).toBe("https://citymcp.com/london/mcp");
    expect(JSON.parse(String(init?.body)).params.name).toBe("city_status");
    return Response.json({ jsonrpc: "2.0", result: { structuredContent: {
      asOf: "2026-10-15T12:00:00Z", signals: [], tubeLines: [{ line: "Northern", status: "Minor delays" }],
    } } });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = boundary === "ask"
    ? await runAsk({ query, skipModel: true })
    : await runPalElevenLabsChatTurn({ query, ownerId: "aggregation-owner" });
  const answer = "answer" in result ? result.answer : result.ok ? result.message : "";
  expect(answer).toContain(emptyAnswer);
  expect(answer).toContain(detail);
  expect(answer).toContain("Northern: Minor delays");
  expect(result).toMatchObject({ toolsUsed: ["city_status", "venue_drinks"], cards: [{ key: "city-status", venueId: "" }] });
  if ("status" in result) expect(result.status).toBe("ready");
  if ("ok" in result && result.ok) {
    expect(result.conversationId).toMatch(/^conv_[a-z0-9]{32}$/);
    expect(await readOwnedPubPalToolTurn(result.conversationId, "aggregation-owner")).toMatchObject({
      query, hints: [answer], proposals: [{ kind: "open_venue", venueId }],
    });
    expect(await readOwnedPubPalToolTurn(result.conversationId, "another-owner")).toBeNull();
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each((["ask", "configured chat"] as const).flatMap((boundary) => ["found", "empty", "failed"].map((journey) => ({ boundary, journey }))))(
  "retains menu and journey outcomes for the same venue through $boundary when the journey is $journey", async ({ boundary, journey }) => {
    const drink = parseDrinkPriceUpdates([{
      venueKey: "sherlock holmes|10 northumberland street, wc2n 5db|51.50730|-0.12534",
      drinkName: "Organic Pinot Grigio, Riff, Italy", category: "wine", priceGbp: 7.2, servingSize: "125ml",
      source: menuSource, observedAt: "2026-10-15T12:00:00Z", lane: "publisher",
    }]);
    expect(drink).toHaveLength(1);
    vi.spyOn(priceUpdates, "venuePriceUpdatesFor").mockResolvedValue({ food: [], drink });
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://citymcp.com/london/mcp");
      expect(JSON.parse(String(init?.body)).params).toMatchObject({
        name: "get_journey", arguments: { from: "51.53000,-0.12400", to: "51.50730,-0.12534" },
      });
      if (journey === "failed") throw new Error("Disposable journey failure");
      return Response.json({ jsonrpc: "2.0", result: { structuredContent: { journeys: journey === "empty" ? [] : [{ durationMinutes: 12, legs: [] }] } } });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = boundary === "ask"
      ? await runAsk({ query: menuQuery, skipModel: true })
      : await runPalElevenLabsChatTurn({ query: menuQuery, ownerId: "aggregation-owner" });
    expect(result).toMatchObject({ toolsUsed: ["journey", "venue_drinks"], cards: [
      ...(journey === "found" ? [{ venueId: "venue-gk2fp9", title: "Journey 1", place: "Sherlock Holmes", note: "12 min", provenance: { kind: "citymcp" } }] : []),
      { venueId: "venue-gk2fp9", title: "Organic Pinot Grigio, Riff, Italy at Sherlock Holmes", price: 7.2,
        menuEvidence: { serving: "125ml", source: menuSource.label, sourceUrl: menuSource.url, observedAt: "2026-10-15T12:00:00Z", availability: "unknown" },
        provenance: { kind: "published-menu", label: menuSource.label, url: menuSource.url } },
    ] });
    const answer = "answer" in result ? result.answer : result.ok ? result.message : "";
    expect(answer).toContain(journey === "found" ? "Found 1 journey option." : journey === "empty" ? "No journey options came back for that pair." : "I couldn't load a journey just now.");
    expect(answer).toContain("Organic Pinot Grigio, Riff, Italy at Sherlock Holmes: £7.20.");
    expect(answer).toContain("Published serving: 125ml.");
    if ("status" in result) expect(result.status).toBe(journey === "failed" ? "degraded" : "ready");
    if ("ok" in result && result.ok) {
      expect(await readOwnedPubPalToolTurn(result.conversationId, "aggregation-owner")).toMatchObject({ query: menuQuery, cards: result.cards, hints: [answer] });
    }
    expect(fetcher).toHaveBeenCalledTimes(journey === "failed" ? 2 : 1);
});

it("keeps the eight-card ceiling and summarizes menu outcomes beyond it", async () => {
  const drink = parseDrinkPriceUpdates(Array.from({ length: 8 }, (_, index) => ({
    venueKey: "sherlock holmes|10 northumberland street, wc2n 5db|51.50730|-0.12534",
    drinkName: `Organic Pinot Grigio fixture ${index + 1}`, category: "wine", priceGbp: 7.2, servingSize: "125ml",
    source: menuSource, observedAt: "2026-10-15T12:00:00Z", lane: "publisher",
  })));
  expect(drink).toHaveLength(8);
  vi.spyOn(priceUpdates, "venuePriceUpdatesFor").mockResolvedValue({ food: [], drink });
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    expect(String(input)).toBe("https://citymcp.com/london/mcp");
    expect(JSON.parse(String(init?.body)).params.name).toBe("get_journey");
    return Response.json({ jsonrpc: "2.0", result: { structuredContent: { journeys: [{ durationMinutes: 12, legs: [] }] } } });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await runAsk({ query: menuQuery, skipModel: true });
  expect(result.cards).toHaveLength(8);
  expect(result.cards[0]).toMatchObject({ title: "Journey 1", venueId: "venue-gk2fp9" });
  expect(result.cards.filter((card) => card.menuEvidence)).toHaveLength(7);
  expect(result.answer).toContain("Found 1 journey option.");
  for (let index = 1; index <= 8; index += 1) {
    expect(result.answer).toContain(`Organic Pinot Grigio fixture ${index} at Sherlock Holmes: £7.20.`);
  }
  expect(result.answer).toContain("Showing the first 8.");
  expect(result.sources).toContainEqual({ kind: "published-menu", label: menuSource.label, url: menuSource.url });
});
