import { describe, expect, it } from "vitest";

import {
  startComparison,
  transitionComparison,
  type ComparisonFlow,
  type ComparisonPlan,
  type ComparisonView,
} from "@/lib/rankingComparisonFlow";
import type { SocialPubBand, SocialPubRankingEntry } from "@/lib/socialPubRankings";

const lamb = { id: "lamb", name: "The Lamb" };
const crown: SocialPubRankingEntry = { venueId: "crown", venueName: "The Crown", band: "loved", place: 1, score: 10 };
const saved: SocialPubRankingEntry[] = [crown, { venueId: "lamb", venueName: "The Lamb", band: "fine", place: 2, score: 6.7 }];
const ask: ComparisonPlan = { band: "loved", session: { band: ["crown"], low: 0, high: 1 }, opponent: "crown", neighbours: { aboveVenueId: null, belowVenueId: "crown" } };
const slot = (band: SocialPubBand = "fine"): ComparisonPlan => ({ band, session: { band: [], low: 0, high: 0 }, opponent: null, neighbours: { aboveVenueId: null, belowVenueId: null } });

function at(view: ComparisonView, patch: Partial<ComparisonFlow> = {}): ComparisonFlow {
  return { ...startComparison(7, [crown]), attempt: 1, view, ...patch };
}
const saving = at({ step: "saving", venue: lamb, band: "fine", neighbours: { aboveVenueId: null, belowVenueId: null }, attempt: 1 }, { uncertain: true });
const checkingLost = at({ step: "checking", venue: lamb, unsettled: { kind: "lost", band: "fine", neighbours: { aboveVenueId: null, belowVenueId: null } }, attempt: 2 }, { attempt: 2, uncertain: true });
const checkingStale = at({ step: "checking", venue: lamb, unsettled: { kind: "stale", band: "loved" }, attempt: 2 }, { attempt: 2, uncertain: true });

describe("comparison flow transitions", () => {
  it("starts at the band for a known pub and at the search otherwise", () => {
    expect(startComparison(7, [], lamb).view).toEqual({ step: "band", venue: lamb, notice: null });
    expect(startComparison(7, []).view).toEqual({ step: "pick", notice: null });
  });

  it("asks a question when the band has pubs, and saves at once when it has none", () => {
    const band = at({ step: "band", venue: lamb, notice: null });
    expect(transitionComparison(band, { type: "band_chosen", plan: ask })).toEqual({
      flow: { ...band, view: { step: "compare", venue: lamb, plan: ask, asked: 0, notice: null } },
      effect: null,
    });
    const { flow, effect } = transitionComparison(band, { type: "band_chosen", plan: slot() });
    expect(flow.view).toMatchObject({ step: "saving", attempt: 2 });
    expect(flow.uncertain).toBe(true);
    expect(effect).toEqual({ type: "save", attempt: 2, venueId: "lamb", band: "fine", neighbours: { aboveVenueId: null, belowVenueId: null } });
  });

  it("acknowledges a confirmed save and publishes the server's list", () => {
    const { flow, effect } = transitionComparison(saving, { type: "save_answered", attempt: 1, account: 7, answer: { kind: "saved", entries: saved } });
    expect(flow).toMatchObject({ list: saved, uncertain: false, unpublished: false, view: { step: "done", placed: saved[1] } });
    expect(effect).toEqual({ type: "publish", entries: saved });
  });

  it.each([
    ["stale", { kind: "stale", band: "fine" }],
    ["unknown", { kind: "lost", band: "fine", neighbours: { aboveVenueId: null, belowVenueId: null } }],
  ] as const)("checks the list after a %s answer", (kind, unsettled) => {
    const { flow, effect } = transitionComparison(saving, { type: "save_answered", attempt: 1, account: 7, answer: { kind } });
    expect(flow.view).toEqual({ step: "checking", venue: lamb, unsettled, attempt: 2 });
    expect(effect).toEqual({ type: "check", attempt: 2 });
  });

  it("keeps the server's reason for a rejected save, and the earlier write still needs a read", () => {
    const { flow, effect } = transitionComparison(saving, { type: "save_answered", attempt: 1, account: 7, answer: { kind: "rejected", message: "Social is paused." } });
    expect(flow.view).toEqual({ step: "band", venue: lamb, notice: "Social is paused." });
    expect(effect).toBeNull();
    expect(transitionComparison(flow, { type: "dismiss" }).effect).toEqual({ type: "close", reason: "dismissed", refresh: true });
  });

  it.each([
    ["a refused save", saving, { type: "save_answered", attempt: 1, account: 7, answer: { kind: "refused" } }],
    ["a refused check", checkingLost, { type: "list_read", attempt: 2, account: 7, read: { kind: "refused" } }],
  ] as const)("retires the flow after %s without a read", (_label, from, event) => {
    const { flow, effect } = transitionComparison(from, event);
    expect(flow.view).toEqual({ step: "closed", reason: "refused" });
    expect(flow.uncertain).toBe(false);
    expect(effect).toEqual({ type: "close", reason: "refused", refresh: false });
  });

  it("acknowledges a lost save the fresh list shows, and asks again when it does not", () => {
    const landed = transitionComparison(checkingLost, { type: "list_read", attempt: 2, account: 7, read: { kind: "entries", entries: saved, landed: true, restart: null } });
    expect(landed.effect).toEqual({ type: "publish", entries: saved });
    const missed = transitionComparison(checkingLost, { type: "list_read", attempt: 2, account: 7, read: { kind: "entries", entries: saved, landed: false, restart: null } });
    expect(missed.flow).toMatchObject({ list: saved, uncertain: true, unpublished: true, view: { step: "band", notice: "We could not confirm that ranking. Choose how it went again." } });
    expect(missed.effect).toBeNull();
  });

  it("restarts the questions on a fresh list after a stale save, and offers a check when the list cannot be read", () => {
    const restarted = transitionComparison(checkingStale, { type: "list_read", attempt: 2, account: 7, read: { kind: "entries", entries: saved, landed: false, restart: ask } });
    expect(restarted.flow.view).toEqual({ step: "compare", venue: lamb, plan: ask, asked: 0, notice: "Your list changed in another tab. A couple more questions." });
    const unread = transitionComparison(checkingStale, { type: "list_read", attempt: 2, account: 7, read: { kind: "unavailable" } });
    expect(unread.flow.view).toEqual({ step: "unconfirmed", venue: lamb, unsettled: { kind: "stale", band: "loved" } });
    expect(transitionComparison(unread.flow, { type: "check_again" }).effect).toEqual({ type: "check", attempt: 3 });
  });

  it("closes without a read only when the caller holds everything the flow knows", () => {
    const fresh = at({ step: "pick", notice: null });
    expect(transitionComparison(fresh, { type: "dismiss" }).effect).toEqual({ type: "close", reason: "dismissed", refresh: false });
    const done = transitionComparison(saving, { type: "save_answered", attempt: 1, account: 7, answer: { kind: "saved", entries: saved } }).flow;
    expect(transitionComparison(done, { type: "dismiss" }).effect).toEqual({ type: "close", reason: "dismissed", refresh: false });
    expect(transitionComparison(saving, { type: "dismiss" }).effect).toEqual({ type: "close", reason: "dismissed", refresh: true });
    expect(transitionComparison({ ...fresh, unpublished: true }, { type: "dismiss" }).effect).toEqual({ type: "close", reason: "dismissed", refresh: true });
  });

  it("closes on an account switch and on nothing else", () => {
    expect(transitionComparison(saving, { type: "account_changed", account: 8 }).flow.view).toEqual({ step: "closed", reason: "dismissed" });
    expect(transitionComparison(saving, { type: "account_changed", account: 7 }).flow).toBe(saving);
  });

  it.each([
    ["an answer for another attempt", saving, { type: "save_answered", attempt: 9, account: 7, answer: { kind: "saved", entries: saved } }],
    ["an answer for another account", saving, { type: "save_answered", attempt: 1, account: 8, answer: { kind: "saved", entries: saved } }],
    ["a list read for another attempt", checkingLost, { type: "list_read", attempt: 1, account: 7, read: { kind: "refused" } }],
    ["a list read while saving", saving, { type: "list_read", attempt: 1, account: 7, read: { kind: "refused" } }],
    ["a band while comparing", at({ step: "compare", venue: lamb, plan: ask, asked: 0, notice: null }), { type: "band_chosen", plan: slot() }],
    ["a pick while saving", saving, { type: "pick", venue: lamb }],
    ["a check while saving", saving, { type: "check_again" }],
    ["rank another while checking", checkingLost, { type: "rank_another" }],
    ["any event once closed", at({ step: "closed", reason: "dismissed" }), { type: "save_answered", attempt: 1, account: 7, answer: { kind: "saved", entries: saved } }],
    ["a second close", at({ step: "closed", reason: "refused" }), { type: "dismiss" }],
  ] as const)("refuses %s with the same state and no effect", (_label, from, event) => {
    const result = transitionComparison(from, event);
    expect(result.flow).toBe(from);
    expect(result.effect).toBeNull();
  });
});
