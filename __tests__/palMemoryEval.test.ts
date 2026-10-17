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

  it("reaches every probe's facts, the oldest memories included, while a turn with no ask still carries only the newest", async () => {
    const scoreboard = await runPalMemoryEval();
    const longMemory = scoreboard.personas.find((persona) => persona.id === "long-memory");
    // Recall ranks by the ask: wine finds the sulphite allergy, getting home
    // finds the Northern line, "everything" finds all eleven.
    expect(longMemory?.probes.every((probe) => probe.answerable)).toBe(true);
    expect(scoreboard.totals.probesAnswerable).toBe(scoreboard.totals.probes);
    // With nothing to rank by, the oldest three stay out of a turn's context.
    expect(longMemory?.typed).toMatchObject({ stretchFound: 0, stretchTotal: 3 });
  });

  it("refuses to seed a durable store", async () => {
    const supabase = await import("@/lib/supabase");
    vi.spyOn(supabase, "isSupabaseConfigured").mockReturnValue(true);
    await expect(runPalMemoryEval()).rejects.toThrow(/process-memory stores/);
    vi.restoreAllMocks();
  });
});
