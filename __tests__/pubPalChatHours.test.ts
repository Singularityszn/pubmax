import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ detail: vi.fn(), schedules: vi.fn() }));
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
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("keyless Pub Pal hours answers", () => {
  it("preserves the recorded hours, card and source", async () => {
    io.detail.mockResolvedValue({ status: "found", venue: { siteFacts: {
      sourceUrl: "https://example.org/hours", readOn: "2026-10-20",
      hours: { hours: { 4: [{ opens: "12:00", closes: "23:00" }] }, statedDays: [4], evidence: "Thursday noon to 11pm" },
    } } });
    const body = await ask();
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
