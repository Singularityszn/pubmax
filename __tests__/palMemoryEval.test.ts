import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

import { loadPalMemorySuite, runPalMemoryEval } from "@/evals/pal/memory/runMemoryEval";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Pal memory eval (retrieval layer)", () => {
  it("surfaces every must fact on typed and voice, with no leak, and touches no network", async () => {
    const networkCalls: string[] = [];
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0]) => {
      networkCalls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      throw new Error("network is off limits to the memory eval");
    });

    const scoreboard = await runPalMemoryEval();
    const failures = scoreboard.personas
      .filter((persona) => !persona.pass)
      .flatMap((persona) =>
        [...persona.typed.checks, ...persona.voice.checks]
          .filter((check) => !check.pass)
          .map((check) => `${persona.id} ${check.name}: ${check.detail}`),
      );

    expect(failures).toEqual([]);
    expect(scoreboard.totals).toMatchObject({ pass: true, mustRecall: 1, leaks: 0 });
    expect(scoreboard.totals.personas).toBe(loadPalMemorySuite().personas.length);
    expect(networkCalls).toEqual([]);
  });

  it("carries every memory someone has under the limit, and past it reaches each one when the ask is about it", async () => {
    const scoreboard = await runPalMemoryEval();
    const byId = (id: string) => scoreboard.personas.find((persona) => persona.id === id);
    // Eleven memories, fewer than a turn carries: all of them, every turn.
    expect(byId("long-memory")?.typed).toMatchObject({ mustFound: 11, mustTotal: 11 });
    // Forty-five: the wheelchair need, the oldest, still reaches every turn.
    expect(byId("vast-memory")?.typed).toMatchObject({ mustFound: 2, mustTotal: 2, stretchFound: 0, stretchTotal: 4 });
    // And each of the four left out of a turn with no ask arrives when asked about.
    expect(byId("vast-memory")?.probes.every((probe) => probe.answerable)).toBe(true);
    expect(scoreboard.totals.probesAnswerable).toBe(scoreboard.totals.probes);
  });

  it("refuses to seed a durable store", async () => {
    const supabase = await import("@/lib/supabase");
    vi.spyOn(supabase, "isSupabaseConfigured").mockReturnValue(true);
    await expect(runPalMemoryEval()).rejects.toThrow(/process-memory stores/);
    vi.restoreAllMocks();
  });
});
