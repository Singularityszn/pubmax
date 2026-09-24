import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runPalEvalSuite } from "@/evals/pal/runSuite";

beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Pal eval suite (deterministic)", () => {
  it("passes every committed case against the hidden answer key without touching the network", async () => {
    const networkCalls: string[] = [];
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0]) => {
      networkCalls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      throw new Error("network is off limits to the deterministic gate");
    });

    const scoreboard = await runPalEvalSuite({ mode: "deterministic" });
    const failures = scoreboard.results.filter((result) => !result.pass);
    expect(failures, failures.map((f) => f.id).join(", ")).toEqual([]);
    expect(networkCalls).toEqual([]);
    expect(scoreboard.totals.cases).toBeGreaterThanOrEqual(20);
    expect(scoreboard.totals.inventedVenues).toBe(0);
    expect(scoreboard.totals.accuracy).toBe(1);
    expect(scoreboard.totals.modelCalls).toBe(0);
  });
});
