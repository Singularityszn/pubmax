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

});
