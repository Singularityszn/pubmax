import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runAsk } from "@/lib/ask/runAsk";

const deniedFetch = vi.fn(async () => { throw new Error("Network is denied for local record answers"); });

beforeEach(() => {
  deniedFetch.mockClear();
  vi.stubGlobal("fetch", deniedFetch);
  for (const key of ["OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    vi.stubEnv(key, "");
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("keeps the explicit Soho pint answer useful after an earlier three-pub request", async () => {
  const query = "Cheap pints near Soho";
  const fresh = await runAsk({ query, cityId: "london", skipModel: true });
  expect(fresh.status).toBe("ready");
  expect(fresh.cards).toHaveLength(4);

  const followUp = await runAsk({
    query,
    cityId: "london",
    skipModel: true,
    turns: [{ role: "user", content: "Find me three pubs near Soho with listed pint prices. Show the source dates and the map." }],
  });

  // A complete current place request keeps its answer regardless of earlier wording.
  expect(followUp.cards).toHaveLength(4);
  expect(followUp.cards.map(card => card.venueId)).toEqual(fresh.cards.map(card => card.venueId));
  expect(followUp.cards.every(card => typeof card.price === "number" && card.price > 0 && Boolean(card.provenance?.label))).toBe(true);
  expect(deniedFetch).not.toHaveBeenCalled();
});
