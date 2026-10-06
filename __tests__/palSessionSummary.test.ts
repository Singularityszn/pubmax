import { describe, expect, it } from "vitest";

import {
  PAL_SESSION_RECENT_TURNS,
  PAL_SESSION_SUMMARY_BYTE_LIMIT,
  palSessionSummaryTurn,
  windowPalSessionTurns,
} from "@/lib/palSessionSummary";
import type { PubPalFenceTurn } from "@/lib/pubPalLlmFence";

const ask = (content: string): PubPalFenceTurn => ({ role: "user", content });

function expectWithinByteCap(turn: string | undefined) {
  expect(turn).toBeDefined();
  const bytes = new TextEncoder().encode(turn as string);
  expect(bytes.length).toBeLessThanOrEqual(PAL_SESSION_SUMMARY_BYTE_LIMIT);
  expect(new TextDecoder().decode(bytes)).toBe(turn);
}

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
    const session = windowPalSessionTurns("quiet   pubs\tin Soho", turns);
    expect(palSessionSummaryTurn(session.summary)).toEqual([
      "My earlier asks, not facts about any pub: quiet pubs in Soho; a pub for six",
    ]);
    expect(session.turns).toHaveLength(PAL_SESSION_RECENT_TURNS);
    expect(session.summary).not.toContain("£3");
  });

  it("drops a whole older ask, never part of one, when an ask itself contains the rendered separator", () => {
    const recent = (offset: number) =>
      Array.from({ length: PAL_SESSION_RECENT_TURNS }, (_, index) => ask(`recent ${offset + index}`));
    let session = windowPalSessionTurns("", [ask("pints under £5; beer garden"), ...recent(0)]);
    expect(palSessionSummaryTurn(session.summary)).toEqual([
      "My earlier asks, not facts about any pub: pints under £5; beer garden",
    ]);

    const filler = "quiet corner table near the fire ".repeat(10).slice(0, 240);
    session = windowPalSessionTurns(session.summary, [ask(filler), ...recent(10)]);
    const [turn] = palSessionSummaryTurn(session.summary);
    expectWithinByteCap(turn);
    expect(turn).not.toContain("beer garden");
    expect(turn).not.toContain("pints under £5");
  });

  it("keeps the emitted summary turn within its byte cap over a long chat, dropping the oldest asks first", () => {
    let session = { summary: "", turns: [] as PubPalFenceTurn[] };
    for (let index = 0; index < 200; index += 1) {
      session = windowPalSessionTurns(session.summary, [
        ...session.turns,
        ask(`ask number ${index} about a quiet pub with a garden near the river`),
      ]);
      const [turn] = palSessionSummaryTurn(session.summary);
      if (turn) expectWithinByteCap(turn);
    }
    expect(session.summary).not.toContain("ask number 0 ");
    expect(session.summary).toContain(`ask number ${199 - PAL_SESSION_RECENT_TURNS} `);
  });

  it("caps a worst-case summary of digits, pound signs, postcodes and emoji at 300 UTF-8 bytes, splitting no character", () => {
    let session = { summary: "", turns: [] as PubPalFenceTurn[] };
    for (let index = 0; index < 100; index += 1) {
      session = windowPalSessionTurns(session.summary, [
        ...session.turns,
        ask(`£4.50 £5 E1 6AN SW1A 1AA 7pm 🍺🍺 #${index}`),
      ]);
      const [turn] = palSessionSummaryTurn(session.summary);
      if (turn) expectWithinByteCap(turn);
    }
    expect(session.summary).toContain(`#${99 - PAL_SESSION_RECENT_TURNS}`);

    const emoji = [ask("🍺£".repeat(1_000)), ...Array.from({ length: PAL_SESSION_RECENT_TURNS }, (_, index) => ask(`recent ${index}`))];
    expectWithinByteCap(palSessionSummaryTurn(windowPalSessionTurns("", emoji).summary)[0]);
    expectWithinByteCap(palSessionSummaryTurn("🍺".repeat(1_000))[0]);
  });

  it("caps a single ask that is longer than the whole budget", () => {
    const long = "cask ".repeat(2_000);
    const turns = [ask(long), ...Array.from({ length: PAL_SESSION_RECENT_TURNS }, (_, index) => ask(`recent ${index}`))];
    expectWithinByteCap(palSessionSummaryTurn(windowPalSessionTurns("", turns).summary)[0]);
  });
});
