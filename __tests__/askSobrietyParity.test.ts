import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/ask/route";
import { runAsk } from "@/lib/ask/runAsk";
import { resetJourneyCache } from "@/lib/citymcp/client";
import { offlineFetch } from "@/evals/pal/offlineFetch";

beforeEach(() => {
  for (const key of ["ANTHROPIC_API_KEY", "TYPESAFE_API_KEY", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    vi.stubEnv(key, "");
  }
  resetJourneyCache();
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => {
    throw new Error("Ask safety tests must stay offline.");
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const registerLine = "I can't tell you whether to have another drink.";
const homeLine = "Open Getting Home on the venue sheet";

describe("Ask sobriety parity", () => {
  it.each(["Should I have one more pint?", "Can I drive after two beers?"])("keeps the shared safety response for %s", async (query) => {
    const response = await runAsk({ query, cityId: "london", skipModel: true, fetchImpl: offlineFetch });
    expect(response.answer).toContain(registerLine);
    expect(response.answer).toContain(homeLine);
    expect(response.cards).toEqual([]);
    expect(response.proposals).toEqual([]);
    expect(response.sources).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the API response in the same safety register", async () => {
    const response = await POST(new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.198" },
      body: JSON.stringify({ query: "Should I have one more pint?", cityId: "london" }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answer).toContain(registerLine);
    expect(body.cards).toEqual([]);
    expect(body.proposals).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a personal safety follow-up grounded in user history", async () => {
    const response = await runAsk({
      query: "What about now?", cityId: "london", skipModel: true, fetchImpl: offlineFetch,
      turns: [{ role: "user", content: "Should I have one more pint?" }],
    });
    expect(response.answer).toContain(registerLine);
    expect(response.cards).toEqual([]);
  });

  it.each(["Find four quiet pubs in Soho", "Where can I find alcohol-free beer in Soho?"])("retains normal discovery for %s despite assistant history", async (query) => {
    const response = await runAsk({
      query, cityId: "london", skipModel: true, fetchImpl: offlineFetch,
      turns: [{ role: "assistant", content: "Should I have one more pint?" }],
    });
    expect(response.answer).not.toContain(registerLine);
    expect(response.answer).not.toContain(homeLine);
    expect(response.toolsUsed.length).toBeGreaterThan(0);
  });

  it("retains sourced journey facts when the user asks about getting home", async () => {
    const journeyFetch = vi.fn<typeof fetch>(async (input, init) => {
      const payload = JSON.parse(String(init?.body));
      if (payload.params.name !== "get_journey") return offlineFetch(input, init);
      return Response.json({ jsonrpc: "2.0", result: { structuredContent: {
        journeys: [{ durationMinutes: 12, legs: [] }],
      } } });
    });
    const response = await runAsk({
      query: "Heading home. Directions to London Bridge from The Blackfriar.",
      cityId: "london", skipModel: true, fetchImpl: journeyFetch,
    });
    expect(response.answer).toContain(homeLine);
    expect(response.toolsUsed).toContain("journey");
    expect(response.cards).toContainEqual(expect.objectContaining({ note: "12 min" }));
    expect(response.sources).toContainEqual(expect.objectContaining({ kind: "citymcp" }));
  });

  it("does not request model routing for an explicit safety question", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "offline-test-only");
    const response = await runAsk({ query: "Should I have one more pint?", cityId: "london", fetchImpl: fetch });
    expect(response.answer).toContain(registerLine);
    expect(response.cards).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
