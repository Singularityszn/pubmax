import { describe, expect, it } from "vitest";

import { panelMineOutcome, type PanelPart } from "@/lib/pubRankingPanelRead";
import {
  heldRanking,
  startRankingCheckpoint,
  transitionRankingCheckpoint,
  type RankingCheckpoint,
} from "@/lib/rankingCheckpoint";

type List = string[];
const reading: RankingCheckpoint<List> = startRankingCheckpoint<List>();
const ready: RankingCheckpoint<List> = { phase: "ready", request: 1, session: "none", data: ["crown"], afterRetry: false };
const open: RankingCheckpoint<List> = { ...ready, session: "open" };
const saved: RankingCheckpoint<List> = { phase: "ready", request: 2, session: "saved", data: ["lamb", "crown"], afterRetry: false };
const unavailable: RankingCheckpoint<List> = { phase: "unavailable", request: 1, session: "none", kept: ["crown"] };

describe("ranking checkpoint transitions", () => {
  it("shows a read's list, and focuses after a retry", () => {
    expect(transitionRankingCheckpoint(reading, { type: "answered", request: 1, outcome: { kind: "data", data: ["crown"] } })).toEqual(ready);
    const retry = transitionRankingCheckpoint(unavailable, { type: "read", retrying: true });
    expect(retry).toEqual({ phase: "reading", request: 2, session: "none", kept: ["crown"], retrying: true, fromSession: false });
    expect(transitionRankingCheckpoint(retry, { type: "answered", request: 2, outcome: { kind: "data", data: ["lamb"] } }))
      .toMatchObject({ phase: "ready", data: ["lamb"], afterRetry: true });
  });

  it("keeps the held list through an outage", () => {
    const again = transitionRankingCheckpoint(ready, { type: "read", retrying: false });
    const out = transitionRankingCheckpoint(again, { type: "answered", request: 2, outcome: { kind: "unavailable" } });
    expect(out).toEqual({ phase: "unavailable", request: 2, session: "none", kept: ["crown"] });
    expect(heldRanking(out)).toEqual(["crown"]);
  });

  it("lets a refusal win in any live phase, including after early rows", () => {
    for (const from of [reading, ready, unavailable]) {
      const next = transitionRankingCheckpoint(from, { type: "answered", request: 1, outcome: { kind: "refused", readerInside: false } });
      expect(next).toEqual({ phase: "refused", request: 1, retired: false });
      expect(heldRanking(next)).toBeNull();
    }
  });

  it("keeps a heading for a reader inside the section or back from its session", () => {
    expect(transitionRankingCheckpoint(reading, { type: "answered", request: 1, outcome: { kind: "refused", readerInside: true } }))
      .toEqual({ phase: "refused", request: 1, retired: true });
    const closed = transitionRankingCheckpoint(open, { type: "session_closed", refresh: false, refused: false });
    expect(closed).toMatchObject({ phase: "reading", fromSession: true, kept: ["crown"] });
    expect(transitionRankingCheckpoint(closed, { type: "answered", request: 2, outcome: { kind: "refused", readerInside: false } }))
      .toEqual({ phase: "refused", request: 2, retired: true });
  });

  it("makes a confirmed save the checkpoint at once and drops older reads", () => {
    expect(transitionRankingCheckpoint(open, { type: "session_saved", data: ["lamb", "crown"] })).toEqual(saved);
    const midRead = transitionRankingCheckpoint(open, { type: "read", retrying: false });
    expect(transitionRankingCheckpoint(midRead, { type: "session_saved", data: ["lamb"] })).toMatchObject({ phase: "ready", request: 3, session: "saved" });
  });

  it("closes a confirmed session without a read, and reads after anything else", () => {
    expect(transitionRankingCheckpoint(saved, { type: "session_closed", refresh: false, refused: false })).toEqual({ ...saved, session: "none" });
    expect(transitionRankingCheckpoint(saved, { type: "session_closed", refresh: true, refused: false })).toMatchObject({ phase: "reading", request: 3, kept: ["lamb", "crown"] });
    expect(transitionRankingCheckpoint(open, { type: "session_closed", refresh: false, refused: false })).toMatchObject({ phase: "reading" });
    expect(transitionRankingCheckpoint(saved, { type: "session_closed", refresh: false, refused: true })).toEqual({ phase: "refused", request: 3, retired: true });
  });

  it("reads again from a refusal when access may have come back", () => {
    const refused: RankingCheckpoint<List> = { phase: "refused", request: 4, retired: true };
    expect(transitionRankingCheckpoint(refused, { type: "read", retrying: false }))
      .toEqual({ phase: "reading", request: 5, session: "none", kept: null, retrying: false, fromSession: false });
  });

  it.each([
    ["an answer for an older request", ready, { type: "answered", request: 0, outcome: { kind: "refused", readerInside: true } }],
    ["a second list for a request already shown", ready, { type: "answered", request: 1, outcome: { kind: "data", data: ["swan"] } }],
    ["a late outage after early rows", ready, { type: "answered", request: 1, outcome: { kind: "unavailable" } }],
    ["any answer once refused", { phase: "refused", request: 1, retired: false }, { type: "answered", request: 1, outcome: { kind: "data", data: ["crown"] } }],
    ["a save once refused", { phase: "refused", request: 1, retired: false }, { type: "session_saved", data: ["crown"] }],
    ["a close once refused", { phase: "refused", request: 1, retired: false }, { type: "session_closed", refresh: true, refused: false }],
    ["opening a session while reading", reading, { type: "session_opened" }],
    ["opening a session that is open", open, { type: "session_opened" }],
  ] as const)("refuses %s with the same state", (_label, from, event) => {
    expect(transitionRankingCheckpoint(from as RankingCheckpoint<List>, event)).toBe(from);
  });
});

describe("the Social panel's two reads", () => {
  const pending = { kind: "pending" } as const;
  const refused = { kind: "refused" } as const;
  const out = { kind: "unavailable" } as const;
  const ok = <T,>(value: T[]): PanelPart<T[]> => ({ kind: "ok", value });

  it.each([
    ["valid pubs while reviews are pending", ok(["crown"]), pending, { kind: "compared", entries: ["crown"] }],
    ["valid pubs while reviews are out", ok(["crown"]), out, { kind: "compared", entries: ["crown"] }],
    ["a late review refusal after valid pubs", ok(["crown"]), refused, { kind: "refused" }],
    ["a ranking refusal", refused, pending, { kind: "refused" }],
    ["an empty ranking waiting for reviews", ok([]), pending, { kind: "wait" }],
    ["an empty ranking with reviews", ok([]), ok([4]), { kind: "stars", stars: [4] }],
    ["an empty ranking with reviews out", ok([]), out, { kind: "unavailable" }],
    ["a ranking still out", pending, ok([4]), { kind: "wait" }],
    ["a failed ranking waiting on a possible refusal", out, pending, { kind: "wait" }],
    ["a failed ranking with reviews answered", out, ok([4]), { kind: "unavailable" }],
  ] as const)("answers %s", (_label, rankings, reviews, result) => {
    expect(panelMineOutcome(rankings as PanelPart<string[]>, reviews as PanelPart<number[]>)).toEqual(result);
  });
});
