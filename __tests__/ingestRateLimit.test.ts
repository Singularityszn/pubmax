import { describe, expect, it } from "vitest";

import { ingestLimiterSnapshot, ingestRateLimited } from "@/lib/ingestRateLimit";

// The two properties the /ingest leaf holds that the shared limiter in
// lib/pintDrops.ts does not, both reachable by the flood the budget exists for.
const WINDOW_MS = 60_000;
const LIMIT = 3;

describe("the /ingest sliding-window budget", () => {
  it("lets a refused address back in on time, because refusals do not extend its window", () => {
    const start = 1_000_000;
    const address = "ingest:refused";

    for (let hit = 0; hit < LIMIT; hit += 1) {
      expect(ingestRateLimited(address, start + hit, LIMIT, WINDOW_MS)).toBe(false);
    }
    for (let refusal = 0; refusal < 50; refusal += 1) {
      expect(ingestRateLimited(address, start + 100 + refusal, LIMIT, WINDOW_MS)).toBe(true);
    }

    expect(ingestRateLimited(address, start + WINDOW_MS + 1, LIMIT, WINDOW_MS)).toBe(false);
  });

  it("drops a key once every hit in its window has expired", () => {
    const start = 5_000_000;
    const stale = "ingest:stale";

    expect(ingestRateLimited(stale, start, LIMIT, WINDOW_MS)).toBe(false);
    expect(ingestLimiterSnapshot()).toHaveProperty(stale);

    expect(ingestRateLimited("ingest:later", start + WINDOW_MS + 1, LIMIT, WINDOW_MS)).toBe(false);

    expect(ingestLimiterSnapshot()).not.toHaveProperty(stale);
  });
});
