import { describe, expect, it } from "vitest";

import {
  PAL_SESSION_RECENT_TURNS,
  PAL_SESSION_SUMMARY_BYTE_LIMIT,
  palSessionSummaryTurn,
  windowPalSessionTurns,
} from "@/lib/palSessionSummary";
import { refineRoutedAskQuery } from "@/lib/ask/router";
import { resolvePalLocality } from "@/lib/palLocality";
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

  it("resolves area references before older turns leave the provider window", () => {
    let session = { summary: "", turns: [ask("Find four pubs in Soho")] };
    for (const budget of [7, 6.8, 6.6, 6.4, 6.2, 6, 5.8, 5.6]) {
      session = windowPalSessionTurns(session.summary, [...session.turns, ask(`Same area, under £${budget} a pint`)]);
      const users = session.turns.map((turn) => turn.content);
      const query = refineRoutedAskQuery("Same area, under £5.50 a pint", users.at(-1), users);
      expect(resolvePalLocality(query, null).label).toBe("Soho");
      expect(session.turns.length).toBeLessThanOrEqual(6);
    }
    const switched = windowPalSessionTurns(session.summary, [...session.turns, ask("Find pubs in Camden"), ask("Same area, under £7 a pint")]);
    expect(resolvePalLocality(switched.turns.at(-1)!.content, null).label).toBe("Camden");
    const alone = windowPalSessionTurns("", [ask("Same area, under £7 a pint")]);
    expect(resolvePalLocality(alone.turns[0]!.content, null).grounded).toBe(false);
  });
  it.each(["Soho or Camden", "Soho or Oxford", "Oxford and York"])("preserves unresolved %s across history normalization", (place) => {
    const budget = "Pints under £6.50 in the same area";
    const session = windowPalSessionTurns("", [ask(`Find pubs in ${place}`), ask(budget)]);
    expect(session.turns.at(-1)?.content).toBe(budget);
    const users = session.turns.map((turn) => turn.content);
    const query = "Find four pubs in the same area";
    expect(refineRoutedAskQuery(query, users.at(-1), users)).toBe(query);
  });

  it.each(["Find four pubs in the same area", "A pub crawl in the same area"])("retains resolved locality before eviction: %s", (query) => {
    const session = windowPalSessionTurns("", [ask("Find pubs in Soho"), ask(query)]);
    expect(resolvePalLocality(session.turns.at(-1)!.content, { kind: "borough", name: "Camden" }).label).toBe("Soho");
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
