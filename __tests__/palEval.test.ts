import { beforeEach, describe, expect, it } from "vitest";

import { runPalEvalSuite } from "@/evals/pal/runSuite";
import { resetPalEvalVenueIndexCache } from "@/evals/pal/venueIndex";

beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  resetPalEvalVenueIndexCache();
});

describe("Pal eval suite (deterministic)", () => {
  it("passes every committed case against the hidden answer key", async () => {
    const scoreboard = await runPalEvalSuite({ mode: "deterministic" });
    const failures = scoreboard.results.filter((result) => !result.pass);
    expect(failures, failures.map((f) => f.id).join(", ")).toEqual([]);
    expect(scoreboard.totals.cases).toBeGreaterThanOrEqual(20);
    expect(scoreboard.totals.inventedVenues).toBe(0);
    expect(scoreboard.totals.accuracy).toBe(1);
  });
});
