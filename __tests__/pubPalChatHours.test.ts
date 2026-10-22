import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ detail: vi.fn(), schedules: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/citymcp/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/citymcp/client")>(),
  fetchCityStatus: io.status,
}));
vi.mock("@/lib/venueDetailIndex", () => ({ lookupVenueDetail: io.detail }));
vi.mock("@/lib/planRouteEvidence.server", () => ({ planOpeningSchedulesForVenues: io.schedules }));
vi.mock("@/lib/supabase", () => ({
  clientIp: () => "203.0.113.44",
  hashIp: (ip: string) => `hashed:${ip}`,
  isSupabaseConfigured: () => false,
  requiresSupabaseStore: () => false,
  checkRateLimitDurableDetailed: async () => ({ verdict: false, reason: "counted" }),
}));
vi.mock("@/lib/authServer", () => ({ callerUserId: async () => null }));

import { POST } from "@/app/api/pub-pal/chat/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import { offlineFetch } from "@/evals/pal/offlineFetch";

async function ask(query = "What are the opening hours of The Crosse Keys?") {
  const response = await POST(new Request("http://localhost/api/pub-pal/chat", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, cityId: "london" }),
  }));
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(() => {
  __resetPintDrops();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T18:00:00Z"));
  vi.stubEnv("ELEVENLABS_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(offlineFetch));
  io.detail.mockResolvedValue({ status: "found", venue: {} });
  io.schedules.mockResolvedValue(new Map());
  io.status.mockResolvedValue({ asOf: "2026-10-22T18:00:00Z", signals: [], tubeLines: [{ line: "Central", status: "Minor delays" }] });
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("keyless Pub Pal hours answers", () => {
  it.each([
    "What are the opening hours of The Crosse Keys and are there Tube delays?",
    "Are there Tube delays and what are The Crosse Keys' opening hours?",
  ])("preserves both tool answers in chat: %s", async (query) => {
    io.detail.mockResolvedValue({ status: "found", venue: { siteFacts: {
      sourceUrl: "https://example.org/hours", readOn: "2026-10-20",
      hours: { hours: { 4: [{ opens: "12:00", closes: "23:00" }] }, statedDays: [4], evidence: "Thursday noon to 11pm" },
    } } });
    const body = await ask(query);
    expect(body.toolsUsed).toEqual(["city_status", "search_venues"]);
    expect(body.answer).toContain("Central: Minor delays");
    expect(body.answer).toContain("The Crosse Keys: recorded regular opening hours: Thursday 12:00 to 23:00");
    expect(body.cards.map((card: { venueId: string }) => card.venueId)).toEqual(["", "venue-zottpx"]);
    expect(body.sources).toContainEqual(expect.objectContaining({ url: "https://example.org/hours" }));
  });

  it.each([
    "What are the opening hours of The Blackfriar and The Old Bell Tavern and are there Tube delays?",
    "What are the opening hours of The Blackfriar and what are the opening hours of The Old Bell Tavern and are there Tube delays?",
    "Are there Tube delays and what are the opening hours of Imaginary Moon Tavern?",
  ])("retains hours clarification beside a city answer: %s", async (query) => {
    const body = await ask(query);
    expect(body.answer).toContain("Central: Minor delays");
    expect(body.answer).toContain("Which pub do you mean?");
    expect(body.cards.map((card: { key: string }) => card.key)).toEqual(["city-status"]);
    expect(io.detail).not.toHaveBeenCalled();
    expect(io.schedules).not.toHaveBeenCalled();
  });

  it.each([
    "Find me one quiet pub in Soho with late opening hours",
    "Find me 2 cosy local pubs in Soho with late opening hours",
  ])("preserves counted discovery in chat: %s", async (query) => {
    const body = await ask(query);
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.answer).not.toContain("Which pub do you mean?");
    expect(io.detail).not.toHaveBeenCalled();
  });

  it.each([
    ["What are the opening hours of The Blackfriar near The Old Bell Tavern?", "The Blackfriar"],
    ["What are the opening hours at The Old Bell Tavern near The Blackfriar?", "The Old Bell Tavern"],
    ["The Blackfriar near The Old Bell Tavern opening hours?", "The Blackfriar"],
    ["What are the closing times for The Blackfriar next to The Old Bell Tavern?", "The Blackfriar"],
    ["What are the closing hours of Blackfriar near The Old Bell Tavern?", "The Blackfriar"],
    ["What are the opening times at The Black Friar, Blackfriars?", "The Blackfriar"],
    ["What are The Black Friar, Blackfriars' opening hours, please?", "The Blackfriar"],
    ["What are The Blackfriar's opening hours near The Old Bell Tavern?", "The Blackfriar"],
    ["What are the opening hours of The Blackfriar near The Old Bell Tavern, please?", "The Blackfriar"],
    ["What are the opening hours of The Blackfriar near The Old Bell Tavern and are there Tube delays?", "The Blackfriar"],
  ])("uses the hours subject rather than a landmark: %s", async (query, name) => {
    const body = await ask(query);
    const cards = body.cards.filter((card: { venueId: string }) => card.venueId);
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe(name);
    expect(body.answer).toContain(`Opening hours for ${name} are not known from a current record.`);
    expect(io.detail).toHaveBeenCalledExactlyOnceWith(cards[0].venueId);
    expect(io.schedules).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ id: cards[0].venueId, name }),
    ]);
  });

  it.each([
    "What are the opening hours of The Blackfriar and The Old Bell Tavern?",
    "What are the opening hours of The Old Bell Tavern or The Blackfriar?",
    "What are the opening hours of Imaginary Moon Tavern near The Old Bell Tavern?",
    "What are The Blackfriar and The Old Bell Tavern's opening hours, please?",
    "What are the opening hours of The Blackfriar and The Old Bell Tavern, please?",
  ])("requests clarification before reading an ambiguous or unknown subject: %s", async (query) => {
    const body = await ask(query);
    expect(body.answer).toContain("Which pub do you mean?");
    expect(body.cards).toEqual([]);
    expect(io.detail).not.toHaveBeenCalled();
    expect(io.schedules).not.toHaveBeenCalled();
  });

  it("preserves discovery for a described pub with an hours preference", async () => {
    const body = await ask("Find me a quiet pub in Soho with late opening hours");
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.answer).not.toContain("Which pub do you mean?");
    expect(body.toolsUsed).toEqual(["search_venues"]);
  });

  it.each([
    "What are the opening hours of The Crosse Keys?",
    "What are the opening hours at a pub called The Crosse Keys?",
    "What are The Crosse Keys' opening hours?",
    "What are the opening hours of The Crosse Keys, please?",
    "What are The Crosse Keys’ opening hours, please?",
    "What are The Crosse Keys opening hours?",
    "What are the opening hours of The Crosse Keys, please?!",
    "What is The Crosse Keys' closing times?",
    "Could you tell me The Crosse Keys' opening hours, please?",
    "Please show me the opening times for The Crosse Keys.",
  ])("preserves the recorded hours, card and source: %s", async (query) => {
    io.detail.mockResolvedValue({ status: "found", venue: { siteFacts: {
      sourceUrl: "https://example.org/hours", readOn: "2026-10-20",
      hours: { hours: { 4: [{ opens: "12:00", closes: "23:00" }] }, statedDays: [4], evidence: "Thursday noon to 11pm" },
    } } });
    const body = await ask(query);
    expect(body.answer).toContain("Thursday 12:00 to 23:00");
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].venueId).toBe("venue-zottpx");
    expect(body.sources).toEqual([body.cards[0].provenance]);
    expect(body.sources[0].url).toBe("https://example.org/hours");
    expect(body.status).toBe("ready");
  });

  it.each(["found", "missing"])("preserves unknown hours with a %s record", async (status) => {
    io.detail.mockResolvedValue(status === "found" ? { status, venue: {} } : { status });
    const body = await ask();
    expect(body.answer).toBe("Opening hours for The Crosse Keys are not known from a current record.");
    expect(body.cards).toHaveLength(1);
    expect(body.sources).toEqual([]);
    expect(body.status).toBe("ready");
  });

  it.each(["unavailable", "exception"])("preserves an hours read failure: %s", async (failure) => {
    if (failure === "exception") io.detail.mockRejectedValue(new Error("read failed"));
    else io.detail.mockResolvedValue({ status: "unavailable" });
    const body = await ask();
    expect(body.answer).toContain("I couldn't check the opening hours");
    expect(body.status).toBe("degraded");
    expect(body.cards).toEqual([]);
    expect(body.sources).toEqual([]);
  });

  it("preserves the request for an unmatched pub name", async () => {
    const body = await ask("What are the opening hours of Imaginary Moon Tavern?");
    expect(body.answer).toContain("Which pub do you mean?");
    expect(body.cards).toEqual([]);
    expect(body.status).toBe("ready");
  });
});
