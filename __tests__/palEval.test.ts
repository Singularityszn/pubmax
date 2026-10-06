import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveFullAnswerKeyEntry } from "@/evals/pal/answerKeyResolver";
import { loadPalEvalSuite } from "@/evals/pal/loadSuite";
import { runPalEvalSuite } from "@/evals/pal/runSuite";
import { defined } from "@/__tests__/helpers/defined";

beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

  it("keeps TypeSafe offline for the run and restores its key afterwards", async () => {
    process.env.TYPESAFE_API_KEY = "eval-test-key";
    const networkCalls: string[] = [];
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0]) => {
      networkCalls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      throw new Error("network is off limits to the deterministic gate");
    });

    const scoreboard = await runPalEvalSuite({ mode: "deterministic" });

    expect(networkCalls).toEqual([]);
    expect(scoreboard.totals.accuracy).toBe(1);
    expect(process.env.TYPESAFE_API_KEY).toBe("eval-test-key");
  });

  it("grades at the answer key's pinned instant whatever the wall clock says", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T19:00:00.000Z"));

    const scoreboard = await runPalEvalSuite({ mode: "deterministic" });
    const failures = scoreboard.results.filter((result) => !result.pass);
    expect(failures, failures.map((f) => f.id).join(", ")).toEqual([]);
  });

  it("regenerates the committed answer key unchanged from committed data", async () => {
    const { cases, answerKey, now } = loadPalEvalSuite();
    const handAuthored = ["answerIncludes", "anyTools", "priceTolerance"] as const;

    for (const caseDef of cases) {
      const committed = defined(answerKey[caseDef.id]);
      const resolved = await resolveFullAnswerKeyEntry(caseDef, {
        now,
        cityId: caseDef.cityId ?? "london",
      });
      const kept = Object.fromEntries(
        handAuthored.filter((key) => committed[key] !== undefined).map((key) => [key, committed[key]]),
      );
      expect({ ...resolved, ...kept }, caseDef.id).toEqual(committed);
    }
  });
});
