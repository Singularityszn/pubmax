import { describe, expect, it } from "vitest";

import {
  PAL_SESSION_RECENT_TURNS,
  PAL_SESSION_SUMMARY_TOKEN_LIMIT,
  estimatePalTokens,
  palSessionSummaryTurn,
  windowPalSessionTurns,
} from "@/lib/palSessionSummary";
import type { PubPalFenceTurn } from "@/lib/pubPalLlmFence";

const ask = (content: string): PubPalFenceTurn => ({ role: "user", content });

describe("Pal rolling session summary", () => {
  it("keeps the newest lines word for word and leaves the summary alone until one rolls off", () => {
    const turns = Array.from({ length: PAL_SESSION_RECENT_TURNS }, (_, index) => ask(`ask ${index}`));
    expect(windowPalSessionTurns("", turns)).toEqual({ summary: "", turns });
    expect(palSessionSummaryTurn("")).toEqual([]);
  });

  it("rolls only the person's own lines, never a Pal reply", () => {
    const turns: PubPalFenceTurn[] = [
      ask("a pub for six"),
      { role: "assistant", content: "The Crown has a £3 pint." },
      ...Array.from({ length: PAL_SESSION_RECENT_TURNS }, (_, index) => ask(`recent ${index}`)),
    ];
    const session = windowPalSessionTurns("quiet   pubs\nin Soho", turns);
    expect(session.summary).toBe("quiet pubs in Soho; a pub for six");
    expect(session.turns).toHaveLength(PAL_SESSION_RECENT_TURNS);
    expect(session.summary).not.toContain("£3");
  });

  it("keeps the emitted summary turn within its token cap over a long chat, dropping the oldest asks first", () => {
    let session = { summary: "", turns: [] as PubPalFenceTurn[] };
    for (let index = 0; index < 200; index += 1) {
      session = windowPalSessionTurns(session.summary, [
        ...session.turns,
        ask(`ask number ${index} about a quiet pub with a garden near the river`),
      ]);
      const [turn] = palSessionSummaryTurn(session.summary);
      if (turn) expect(estimatePalTokens(turn)).toBeLessThanOrEqual(PAL_SESSION_SUMMARY_TOKEN_LIMIT);
    }
    expect(session.summary).not.toContain("ask number 0 ");
    expect(session.summary).toContain(`ask number ${199 - PAL_SESSION_RECENT_TURNS} `);
  });

  it("caps asks dense with prices, postcodes and emoji at three UTF-8 bytes per token, splitting no character", () => {
    let session = { summary: "", turns: [] as PubPalFenceTurn[] };
    for (let index = 0; index < 100; index += 1) {
      session = windowPalSessionTurns(session.summary, [
        ...session.turns,
        ask(`pints under £5 near E1 6AN by 7pm 🍺🍺 #${index}`),
      ]);
    }
    const [turn] = palSessionSummaryTurn(session.summary);
    expect(turn).toBeDefined();
    const bytes = new TextEncoder().encode(turn as string);
    expect(bytes.length).toBeLessThanOrEqual(PAL_SESSION_SUMMARY_TOKEN_LIMIT * 3);
    expect(new TextDecoder().decode(bytes)).toBe(turn);

    const emoji = [ask("🍺".repeat(1_000)), ...Array.from({ length: PAL_SESSION_RECENT_TURNS }, (_, index) => ask(`recent ${index}`))];
    const [capped] = palSessionSummaryTurn(windowPalSessionTurns("", emoji).summary);
    const cappedBytes = new TextEncoder().encode(capped as string);
    expect(cappedBytes.length).toBeLessThanOrEqual(PAL_SESSION_SUMMARY_TOKEN_LIMIT * 3);
    expect(new TextDecoder().decode(cappedBytes)).toBe(capped);
  });

  it("caps a single ask that is longer than the whole budget", () => {
    const long = "cask ".repeat(2_000);
    const turns = [ask(long), ...Array.from({ length: PAL_SESSION_RECENT_TURNS }, (_, index) => ask(`recent ${index}`))];
    const [turn] = palSessionSummaryTurn(windowPalSessionTurns("", turns).summary);
    expect(turn).toBeDefined();
    expect(estimatePalTokens(turn as string)).toBeLessThanOrEqual(PAL_SESSION_SUMMARY_TOKEN_LIMIT);
  });
});
