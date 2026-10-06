import { describe, expect, it } from "vitest";

import {
  acceptedProposalFactSource,
  buildFactClaims,
  FACT_AUTHORITY_RANK,
  resolveClaims,
  type FactSource,
} from "@/lib/factClaims";
import { priceConfidence } from "@/lib/priceConfidence";
import { defined } from "@/__tests__/helpers/defined";

const NOW = Date.UTC(2026, 6, 20, 20, 0, 0);
const DAY = 86_400_000;
const FIELD = "price:venue-1:pint";

// Build one source at a value, defaulting the axes so a test can vary exactly
// the one dimension it is asserting about.
function src(value: number, over: Partial<FactSource<number>> = {}): FactSource<number> {
  return {
    authority: "community",
    value,
    observedAt: NOW,
    publisher: `pub-${Math.random()}`,
    confidence: 0.5,
    ...over,
  };
}

// A single-source claim for one value, so resolution ordering can be tested one
// axis at a time.
function claim(value: number, over: Partial<FactSource<number>> = {}) {
  return buildFactClaims(FIELD, [src(value, over)])[0];
}

describe("resolution ordering — authority > freshness > corroboration > confidence", () => {
  it("authority wins even against a fresher, corroborated, higher-confidence rival", () => {
    // Losing rival is better on EVERY lower axis; authority alone must decide.
    const official = claim(6.4, { authority: "official", observedAt: NOW - 300 * DAY, confidence: 0.1 });
    const community = defined(buildFactClaims(FIELD, [
      src(6.9, { authority: "community", observedAt: NOW, publisher: "a", confidence: 0.99 }),
      src(6.9, { authority: "scraped", observedAt: NOW, publisher: "b", confidence: 0.99 }),
    ])[0]);
    expect(community.verification).toBe("corroborated"); // rival is genuinely stronger below authority
    const res = resolveClaims([defined(community), defined(official)], { now: NOW, conflictWindowMs: 30 * DAY });
    expect(res?.winner.value).toBe(6.4);
    expect(res?.winner.authority).toBe("official");
  });

  it("at equal authority, freshness wins over corroboration and confidence", () => {
    const fresh = claim(6.5, { authority: "scraped", observedAt: NOW, confidence: 0.1 });
    const stale = defined(buildFactClaims(FIELD, [
      src(6.6, { authority: "scraped", observedAt: NOW - 5 * DAY, publisher: "a", confidence: 0.99 }),
      src(6.6, { authority: "community", observedAt: NOW - 5 * DAY, publisher: "b", confidence: 0.99 }),
    ])[0]);
    expect(stale.verification).toBe("corroborated");
    const res = resolveClaims([defined(stale), defined(fresh)], { now: NOW, conflictWindowMs: 30 * DAY });
    expect(res?.winner.value).toBe(6.5);
  });

  it("at equal authority and freshness, corroboration wins over confidence", () => {
    const corroborated = defined(buildFactClaims(FIELD, [
      src(6.7, { authority: "scraped", observedAt: NOW, publisher: "a", confidence: 0.2 }),
      src(6.7, { authority: "community", observedAt: NOW, publisher: "b", confidence: 0.2 }),
    ])[0]);
    const lone = claim(6.8, { authority: "scraped", observedAt: NOW, confidence: 0.99 });
    expect(corroborated.verification).toBe("corroborated");
    expect(defined(lone).verification).toBe("single_source");
    const res = resolveClaims([defined(lone), defined(corroborated)], { now: NOW, conflictWindowMs: 30 * DAY });
    expect(res?.winner.value).toBe(6.7);
  });

  it("at equal authority, freshness and corroboration, confidence breaks the tie", () => {
    const strong = claim(6.1, { authority: "scraped", observedAt: NOW, confidence: 0.9 });
    const weak = claim(6.2, { authority: "scraped", observedAt: NOW, confidence: 0.3 });
    const res = resolveClaims([defined(weak), defined(strong)], { now: NOW, conflictWindowMs: 30 * DAY });
    expect(res?.winner.value).toBe(6.1);
  });

  it("manual_review outranks single_source but not corroborated on the corroboration axis", () => {
    const reviewed = claim(5.0, { authority: "scraped", observedAt: NOW, confidence: 0.5, reviewed: true });
    const lone = claim(5.1, { authority: "scraped", observedAt: NOW, confidence: 0.5 });
    expect(defined(reviewed).verification).toBe("manual_review");
    expect(resolveClaims([defined(lone), defined(reviewed)], { now: NOW, conflictWindowMs: 30 * DAY })?.winner.value).toBe(5.0);

    const corroborated = buildFactClaims(FIELD, [
      src(5.2, { authority: "scraped", observedAt: NOW, publisher: "a" }),
      src(5.2, { authority: "community", observedAt: NOW, publisher: "b" }),
    ])[0];
    expect(resolveClaims([defined(reviewed), defined(corroborated)], { now: NOW, conflictWindowMs: 30 * DAY })?.winner.value).toBe(5.2);
  });
});

describe("conflict-window behaviour", () => {
  it("flags a live conflict when a disagreeing claim is within the window", () => {
    const baseline = claim(6.4, { authority: "scraped", observedAt: 0, publisher: "dataset" });
    const fresh = claim(6.9, { authority: "community", observedAt: NOW - 2 * DAY });
    const res = resolveClaims([defined(baseline), defined(fresh)], { now: NOW, conflictWindowMs: 14 * DAY });
    expect(res?.winner.value).toBe(6.4); // scraped serves by authority
    expect(res?.conflict).not.toBeNull();
    expect(res?.conflict?.values).toEqual([6.4, 6.9]); // winner first, disagreeing exposed
  });

  it("does NOT flag a conflict when the disagreeing claim has aged past the window", () => {
    const baseline = claim(6.4, { authority: "scraped", observedAt: 0, publisher: "dataset" });
    const stale = claim(6.9, { authority: "community", observedAt: NOW - 40 * DAY });
    const res = resolveClaims([defined(baseline), defined(stale)], { now: NOW, conflictWindowMs: 14 * DAY });
    expect(res?.winner.value).toBe(6.4);
    expect(res?.conflict).toBeNull(); // stale disagreement is history, resolves cleanly
  });

  it("the winner is always live even when itself undated", () => {
    const baseline = claim(6.4, { authority: "scraped", observedAt: 0, publisher: "dataset" });
    const res = resolveClaims([defined(baseline)], { now: NOW, conflictWindowMs: 14 * DAY });
    expect(res?.conflict).toBeNull();
    expect(res?.winner.value).toBe(6.4);
  });

  it("returns null for an empty claim set", () => {
    expect(resolveClaims([], { now: NOW, conflictWindowMs: 14 * DAY })).toBeNull();
  });

  it("agreeing recent claims are not a conflict", () => {
    const a = claim(6.5, { authority: "scraped", observedAt: NOW, publisher: "dataset" });
    const b = claim(6.5, { authority: "community", observedAt: NOW });
    const res = resolveClaims([defined(a), defined(b)], { now: NOW, conflictWindowMs: 14 * DAY });
    expect(res?.conflict).toBeNull();
  });
});

describe("adapter API stability — priceConfidence still answers { state, label }", () => {
  it("dates a recently observed price as fresh, and says nothing about it", () => {
    expect(priceConfidence({ priceObservedAt: NOW - DAY }, NOW)).toEqual({
      state: "fresh",
      label: null,
    });
  });

  it("a price with no observation date still yields the fresh-look line", () => {
    const out = priceConfidence({}, NOW);
    expect(out.state).toBe("stale");
    expect(out.label).toBe("worth a fresh look");
  });
});

describe("generality — the model serves a non-price fact (hours)", () => {
  it("resolves an hours string fact and exposes a live disagreement", () => {
    const official: FactSource<string> = {
      authority: "official",
      value: "17:00-23:00",
      observedAt: 0,
      publisher: "venue",
    };
    const community: FactSource<string> = {
      authority: "community",
      value: "17:00-00:00",
      observedAt: NOW - DAY,
      publisher: "regular",
    };
    const claims = buildFactClaims("hours:venue-1", [official, community]);
    const res = resolveClaims(claims, { now: NOW, conflictWindowMs: 14 * DAY });
    expect(res?.winner.value).toBe("17:00-23:00"); // official serves
    expect(res?.conflict?.values).toEqual(["17:00-23:00", "17:00-00:00"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Operator rail bridge (Wayfinder 3.5): an accepted operator proposal folds in as
// an `operator` FactSource — additive, attributed, and RANK 0 so it can never
// silently outrank the observed corpus (renamed from the reserved operator-future
// slot #483, semantics unchanged).
// ─────────────────────────────────────────────────────────────────────────────
describe("acceptedProposalFactSource (operator materialisation)", () => {
  it("builds a reviewed operator source at rank 0", () => {
    const src = acceptedProposalFactSource({
      value: "Open till 1am",
      acceptedAt: NOW,
      publisher: "operator:acct-1",
    });
    expect(src.authority).toBe("operator");
    expect(src.value).toBe("Open till 1am");
    expect(src.observedAt).toBe(NOW);
    expect(src.reviewed).toBe(true);
    expect(FACT_AUTHORITY_RANK.operator).toBe(0);
  });

  it("never outranks an observed present fact — surfaces as a conflict instead", () => {
    const scraped: FactSource<string> = {
      authority: "scraped",
      value: "17:00-23:00",
      observedAt: NOW - DAY,
      publisher: "dataset",
    };
    const operator = acceptedProposalFactSource({
      value: "17:00-01:00",
      acceptedAt: NOW,
      publisher: "operator:acct-1",
    });
    const claims = buildFactClaims("hours:venue-9", [scraped, operator]);
    const res = resolveClaims(claims, { now: NOW, conflictWindowMs: 14 * DAY });
    // Scraped (rank 2) still serves; the fresher operator claim is EXPOSED as a
    // live conflict, never a silent overwrite.
    expect(res?.winner.value).toBe("17:00-23:00");
    expect(res?.conflict?.values).toContain("17:00-01:00");
  });
});
