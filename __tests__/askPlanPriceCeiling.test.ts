import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { deniedFetch } = vi.hoisted(() => {
  const deniedFetch = vi.fn(async () => { throw new Error("This proof does not allow network requests"); });
  vi.stubGlobal("fetch", deniedFetch);
  return { deniedFetch };
});

vi.mock("@/lib/serverEnv", () => ({ assertProductionSecrets: () => {} }));
vi.mock("@/lib/pintDrops", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pintDrops")>("@/lib/pintDrops");
  return { ...actual, isLimited: vi.fn(async () => false) };
});

import { POST } from "@/app/api/ask/route";
import { runAskTool } from "@/lib/ask/tools";

beforeEach(() => {
  for (const key of [
    "OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "GOOGLE_PLACES_API_KEY",
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "ELEVENLABS_API_KEY", "ELEVENLABS_PUB_PAL_AGENT_ID",
  ]) vi.stubEnv(key, "");
  deniedFetch.mockClear();
  vi.stubGlobal("fetch", deniedFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("grounded plan price ceilings", () => {
  it("withholds an impossible ceiling at the public Ask route", async () => {
    const response = await POST(new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.244" },
      body: JSON.stringify({ query: "Plan a crawl in Soho for three under £0.01 a pint", cityId: "london" }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.toolsUsed).toEqual(["propose_plan"]);
    expect(body.cards).toEqual([]);
    expect(body.proposals).toEqual([]);
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it("withholds a plan when no listed positive pint meets its ceiling", async () => {
    const query = "Plan a crawl in Soho for three under £0.01 a pint";
    const result = await runAskTool("propose_plan", {}, { cityId: "london", query, skipModel: true });
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ intent: { maxPintPrice: 0.01 } });
    expect(result.cards).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.answerHint).toMatch(/No three-stop route/);
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it("keeps a six-pound-fifty ceiling tied to listed pint evidence", async () => {
    const query = "Plan a crawl in Soho under £6.50 a pint";
    const result = await runAskTool("propose_plan", {}, { cityId: "london", query, skipModel: true });
    expect(result.data).toMatchObject({ intent: { maxPintPrice: 6.5 } });
    expect(result.cards.length).toBeGreaterThan(0);
    for (const card of result.cards) {
      expect(typeof card.price === "number" && card.price > 0 && card.price <= 6.5).toBe(true);
      expect(result.priceEvidence).toContainEqual(expect.objectContaining({
        cardKey: card.key, venueId: card.venueId, priceGbp: card.price,
        kind: "listed-pint", category: "beer", serving: "pint",
      }));
    }
    if (result.cards.length < 3) expect(result.proposals).toEqual([]);
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});
