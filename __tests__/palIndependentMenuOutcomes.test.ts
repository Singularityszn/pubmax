import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { offlineFetch } from "@/evals/pal/offlineFetch";

vi.mock("@/lib/supabase", () => ({
  clientIp: () => "203.0.113.44", hashIp: (ip: string) => ip,
  isSupabaseConfigured: () => false, requiresSupabaseStore: () => false,
}));

import { runAskTool } from "@/lib/ask/tools";
import { runAsk } from "@/lib/ask/runAsk";
import { routeAskDeterministically } from "@/lib/ask/router";
import { runPalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";
import { invokePubPalAskTool } from "@/lib/pubPalToolInvoke.server";
import { registerPubPalToolTurn, readOwnedPubPalToolTurn, __resetPubPalToolTurnStore } from "@/lib/pubPalToolTurnStore";
import { memoryWhatsOnListingStore, __resetWhatsOnListingStore } from "@/lib/whatsOnListingStore";
import { __resetWhatsOnLiveTopUp } from "@/lib/whatsOnStore";
import { resetThingsToDoCache } from "@/lib/citymcp/client";
import * as priceUpdates from "@/lib/priceUpdates.server";
import type { WhatsOnRow } from "@/lib/whatsOn";

const now = Date.parse("2026-10-15T18:00:00Z");
const conversationId = "conv_independentmenu01";
const eventSource = { label: "Disposable listing fixture", url: "https://example.com/camden-fixture" };
const menuClause = "price of Mixed Olives at The New Inn";
const eventClauses = [
  ["music", "Any live music tonight in Camden"],
  ["quiz", "Any quiz tonight in Camden"],
  ["sport", "Any live sport tonight in Camden"],
  ["deal", "Any deals tonight in Camden"],
  ["event", "Any comedy tonight in Camden"],
] as const;
const eventAliases = [
  ["music", "Gigs tonight in Camden"],
  ["music", "Karaoke tonight in Camden"],
  ["quiz", "Trivia tonight in Camden"],
  ["sport", "Football tonight in Camden"],
  ["deal", "Happy hour tonight in Camden"],
  ["event", "Theatre tonight in Camden"],
] as const;

beforeEach(async () => {
  for (const key of ["ELEVENLABS_API_KEY", "ELEVENLABS_PUB_PAL_AGENT_ID", "OPENROUTER_API_KEY", "TYPESAFE_API_KEY"]) vi.stubEnv(key, "");
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.stubGlobal("fetch", offlineFetch);
  __resetPubPalToolTurnStore();
  __resetWhatsOnListingStore();
  __resetWhatsOnLiveTopUp();
  resetThingsToDoCache();
  for (const [kind] of eventClauses) {
    const row: WhatsOnRow = {
      id: `fixture-${kind}`, venueId: "venue-17qpap6", kind,
      placeName: "Disposable stage, Camden", title: `Disposable ${kind} listing`,
      lat: 51.54, lng: -0.14, startsAt: "2026-10-15T19:00:00Z", endsAt: "2026-10-15T22:00:00Z",
      source: eventSource, observedAt: "2026-10-15T17:00:00Z", confidence: "listed",
    };
    await memoryWhatsOnListingStore.replaceKind(kind, [row,
      { ...row, id: `elsewhere-${kind}`, placeName: "Disposable stage, Soho" },
      { ...row, id: `tomorrow-${kind}`, startsAt: "2026-10-16T19:00:00Z", endsAt: "2026-10-16T22:00:00Z" },
    ], "2026-10-15T17:00:00Z");
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  __resetPubPalToolTurnStore();
  __resetWhatsOnListingStore();
  __resetWhatsOnLiveTopUp();
  resetThingsToDoCache();
});

const mixedCases = [...eventClauses, ...eventAliases].flatMap(([kind, events]) => [
  { kind, events, query: `${events} and ${menuClause}` },
  { kind, events, query: `${menuClause} and ${events}` },
]);

it.each(mixedCases)("keeps independent event identity and validated scope: $query", async ({ query, kind }) => {
  const result = await runAskTool("whats_on", { query: "Any live music in Soho" }, { query, cityId: "london", skipModel: true });
  expect(result.tool).toBe("whats_on");
  expect(result.data).toMatchObject({ kind, area: "Camden", window: "tonight" });
  expect(result.cards.map((card) => card.key)).toEqual([`fixture-${kind}`]);
  expect(result.provenance).toEqual([{ ...eventSource, kind: "whats-on" }]);
});

it.each(mixedCases.flatMap((record) => ["keyless", "configured", "stored"].map((boundary) => ({ ...record, boundary }))))(
  "preserves independently sourced event and menu outcomes through $boundary: $query", async ({ query, kind, boundary }) => {
    const result = await mixedAnswer(query, boundary);
    expect(result.toolsUsed).toEqual(["whats_on", "venue_drinks"]);
    expect(result.cards).toHaveLength(2);
    expect(result.cards).toContainEqual(expect.objectContaining({ key: `fixture-${kind}`, provenance: { ...eventSource, kind: "whats-on" } }));
    expect(result.cards).toContainEqual(expect.objectContaining({ price: 5, menuEvidence: expect.objectContaining({ itemName: "Mixed Olives", caloriesKcal: 163, availability: "unknown" }) }));
    expect(result.sources).toContainEqual({ ...eventSource, kind: "whats-on" });
    expect(result.sources).toContainEqual({ kind: "published-menu", label: "The New Inn - official published menu", url: "https://www.newinnealing.com/food-and-drink" });
    expect(result.answer).toContain("Camden tonight");
    expect(result.answer).toContain("Mixed Olives at The New Inn: £5.00");
  },
);

async function mixedAnswer(query: string, boundary: string) {
  if (boundary === "keyless") return runAsk({ query, cityId: "london", skipModel: true });
  await registerPubPalToolTurn(conversationId, { query, cityId: "london", ownerId: "menu-owner" });
  if (boundary === "configured") {
    vi.stubEnv("ELEVENLABS_API_KEY", "offline-test-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "offline-agent");
    const result = await runPalElevenLabsChatTurn({ query, cityId: "london", ownerId: "menu-owner", threadId: conversationId });
    if (!result.ok) throw new Error(result.code);
    const replay = await readOwnedPubPalToolTurn(conversationId, "menu-owner");
    expect(replay?.cards).toEqual(result.cards);
    expect(await readOwnedPubPalToolTurn(conversationId, "another-owner")).toBeNull();
    return { ...result, answer: result.message, sources: result.cards.flatMap((card) => card.provenance ? [card.provenance] : []) };
  }
  const events = await invokePubPalAskTool({ toolName: "whats_on", args: { query: "Any live music in Soho" }, conversationId });
  expect(events.result.tool).toBe("whats_on");
  await invokePubPalAskTool({ toolName: "venue_prices", args: { venueName: "The Lamb", query: "Pint at The Lamb" }, conversationId });
  const replay = await readOwnedPubPalToolTurn(conversationId, "menu-owner");
  if (!replay) throw new Error("Stored outcomes disappeared");
  expect(replay.query).toBe(query);
  expect(await readOwnedPubPalToolTurn(conversationId, "another-owner")).toBeNull();
  return { ...replay, answer: replay.hints.join(" "), sources: replay.cards.flatMap((card) => card.provenance ? [card.provenance] : []) };
}

it.each(["keyless", "configured", "stored"])("preserves event success and honest menu read failure through %s", async (boundary) => {
  vi.spyOn(priceUpdates, "venuePriceUpdatesFor").mockResolvedValue(null);
  const result = await mixedAnswer(`${eventClauses[0][1]} and ${menuClause}`, boundary);
  expect(result.toolsUsed).toEqual(["whats_on", "venue_drinks"]);
  expect(result.cards.map((card) => card.key)).toEqual(["fixture-music"]);
  expect(result.answer).toContain("sourced live-music night in Camden tonight");
  expect(result.answer).toContain("couldn't read the accepted menu at The New Inn");
});

it.each(["keyless", "configured", "stored"])("preserves menu success and honest event read failure through %s", async (boundary) => {
  vi.spyOn(memoryWhatsOnListingStore, "readAll").mockRejectedValue(new Error("Disposable store unavailable"));
  const result = await mixedAnswer(`${eventClauses[0][1]} and ${menuClause}`, boundary);
  expect(result.toolsUsed).toEqual(["whats_on", "venue_drinks"]);
  expect(result.cards).toHaveLength(1);
  expect(result.cards.map((card) => card.menuEvidence?.itemName)).toEqual(["Mixed Olives"]);
  expect(result.answer).toContain("couldn't load sourced listings");
  expect(result.answer).toContain("Mixed Olives at The New Inn: £5.00");
});

it.each([
  { events: "Any live music tonight in Hackney", menu: menuClause, missing: "No sourced live-music nights in Hackney tonight" },
  { events: eventClauses[0][1], menu: "price of Imaginary Snack at The New Inn", missing: "No accepted menu item matches" },
  { events: eventClauses[0][1], menu: "price of Mixed Olives under £5 at The New Inn", missing: "No accepted menu item matches" },
])("keeps an independently requested empty outcome: $missing", async ({ events, menu, missing }) => {
  const result = await runAsk({ query: `${events} and ${menu}`, skipModel: true });
  expect(result.toolsUsed).toEqual(["whats_on", "venue_drinks"]);
  expect(result.cards).toHaveLength(1);
  expect(result.answer).toContain(missing);
});

it("does not replace an unrelated non-price tool", async () => {
  const result = await runAskTool("find_desk", { query: "A desk with wifi" }, { query: `${eventClauses[0][1]} and ${menuClause}`, cityId: "london", skipModel: true });
  expect(result.tool).toBe("find_desk");
  expect(result.cards.some((card) => card.menuEvidence)).toBe(false);
});

it("returns the genuine event failure through stored dispatch", async () => {
  vi.spyOn(memoryWhatsOnListingStore, "readAll").mockRejectedValue(new Error("Disposable store unavailable"));
  await registerPubPalToolTurn(conversationId, { query: `${eventClauses[0][1]} and ${menuClause}`, cityId: "london", ownerId: "menu-owner" });
  const { result } = await invokePubPalAskTool({ toolName: "whats_on", args: { query: "Any live music in Soho" }, conversationId });
  expect(result).toMatchObject({ tool: "whats_on", ok: false, degraded: true, cards: [], sources: [] });
});

const mealRefusal = "I can't compare meal prices or check dietary options yet. I can help you find pubs with food.";
const mealClause = "how much is a burger in Camden?";
const unsupportedMixed = [
  `${eventClauses[0][1]} and ${mealClause}`,
  `How much is a burger in Camden and any live music tonight in Camden?`,
];

it.each(unsupportedMixed)("schedules and dispatches the independent event beside an unsupported meal price: %s", async (query) => {
  expect(routeAskDeterministically(query)).toEqual([{ name: "whats_on", args: { query: expect.stringMatching(/^any live music tonight in Camden/i) } }]);
  const events = await runAskTool("whats_on", { query: "Any live music in Soho" }, { query, cityId: "london", skipModel: true });
  expect(events).toMatchObject({ tool: "whats_on", ok: true, data: expect.objectContaining({ kind: "music", area: "Camden", window: "tonight" }) });
  expect(events.cards.map((card) => card.key)).toEqual(["fixture-music"]);
  for (const toolName of ["venue_prices", "search_venues", "find_desk"]) {
    const refused = await runAskTool(toolName, { query: "Pint at The Lamb", venueName: "The Lamb" }, { query, cityId: "london", skipModel: true });
    expect(refused).toMatchObject({ ok: false, tool: toolName, answerHint: mealRefusal, cards: [] });
  }
});

it.each(unsupportedMixed.flatMap((query) => ["keyless", "configured"].map((boundary) => ({ query, boundary }))))(
  "answers the event and refuses the meal price through $boundary: $query", async ({ query, boundary }) => {
    vi.stubGlobal("WebSocket", class { constructor() { throw new Error("Provider socket must stay closed"); } });
    let result: { answer: string; cards: Array<{ key: string; price?: number | null; menuEvidence?: unknown }>; toolsUsed: string[] };
    if (boundary === "keyless") {
      result = await runAsk({ query, cityId: "london", skipModel: true });
    } else {
      vi.stubEnv("ELEVENLABS_API_KEY", "offline-test-key");
      vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "offline-agent");
      const outcome = await runPalElevenLabsChatTurn({ query, cityId: "london", ownerId: "menu-owner" });
      if (!outcome.ok) throw new Error(outcome.code);
      result = { ...outcome, answer: outcome.message };
    }
    expect(result.toolsUsed).toEqual(["whats_on"]);
    expect(result.cards.map((card) => card.key)).toEqual(["fixture-music"]);
    expect(result.cards.every((card) => card.price === null && card.menuEvidence === undefined)).toBe(true);
    expect(result.answer).toContain(mealRefusal);
    expect(result.answer).toContain("Found 1 sourced live-music night in Camden tonight.");
  },
);

it.each(unsupportedMixed)("keeps the stored event outcome and the stored meal refusal: %s", async (query) => {
  await registerPubPalToolTurn(conversationId, { query, cityId: "london", ownerId: "menu-owner" });
  const events = await invokePubPalAskTool({ toolName: "whats_on", args: { query: "Any live music in Soho" }, conversationId });
  expect(events.result).toMatchObject({ tool: "whats_on", ok: true });
  const price = await invokePubPalAskTool({ toolName: "venue_prices", args: { venueName: "The Lamb", query: "Pint at The Lamb" }, conversationId });
  expect(price.result).toMatchObject({ ok: false, code: "UNSUPPORTED_FOOD_PRICE_COMPARISON", answerHint: mealRefusal, cards: [] });
  const replay = await readOwnedPubPalToolTurn(conversationId, "menu-owner");
  expect(replay?.query).toBe(query);
  expect(replay?.cards.map((card) => card.key)).toEqual(["fixture-music"]);
  expect(replay?.hints).toEqual(["Found 1 sourced live-music night in Camden tonight.", mealRefusal]);
  const provider = await invokePubPalAskTool({ toolName: "whats_on", args: { query }, conversationId: null });
  expect(provider.result).toMatchObject({ tool: "whats_on", ok: true });
});

it.each([
  "How much is a burger with live music in Camden?",
  "How much is a burger in Camden?",
  "How much are live music tickets in Camden and how much is a burger in Camden?",
])("refuses an event tool when no independent event clause exists: %s", async (query) => {
  expect(routeAskDeterministically(query)).toEqual([]);
  const refused = await runAskTool("whats_on", { query: "Any live music tonight in Camden" }, { query, cityId: "london", skipModel: true });
  expect(refused).toMatchObject({ ok: false, tool: "whats_on", cards: [] });
  await registerPubPalToolTurn(conversationId, { query, cityId: "london", ownerId: "menu-owner" });
  const stored = await invokePubPalAskTool({ toolName: "whats_on", args: { query: "Any live music tonight in Camden" }, conversationId });
  expect(stored.result).toMatchObject({ ok: false, cards: [] });
  const result = await runAsk({ query, cityId: "london", skipModel: true });
  expect(result.toolsUsed).toEqual([]);
  expect(result.cards).toEqual([]);
});

it("keeps a pure event request outside menu routing", async () => {
  expect(routeAskDeterministically(eventClauses[0][1]).map((call) => call.name)).toEqual(["whats_on"]);
  const result = await runAsk({ query: eventClauses[0][1], skipModel: true });
  expect(result.toolsUsed).toEqual(["whats_on"]);
  expect(result.cards.map((card) => card.key)).toEqual(["fixture-music"]);
});
