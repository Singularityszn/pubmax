import { afterEach, describe, expect, it, vi } from "vitest";

import type { LegacyPintPrice } from "@/lib/drinks";
import {
  LANDING_EVIDENCE_DEADLINE_MS,
  comparatorEvidenceFor,
  readLandingEvidence,
  settleEachRead,
} from "@/lib/landingEvidenceRead";

// The landing card's near-you evidence reads (lib/landingEvidenceRead.ts).
// Review on PR 2414 (P2s): the saving line's comparator must wear evidence for
// its OWN printed price, and the card's two reads must settle on their own,
// each with a deadline, so a stalled read cannot hold back the other.

function row(price: number, named: boolean, observedAt: string | null = "2026-10-02T12:00:00.000Z"): LegacyPintPrice {
  return {
    app_price_id: `row-${price}`,
    pint_name: "Lager",
    price_gbp: price,
    // A row names its publisher by its own page (lib/legacyPriceEvidence.mjs).
    ...(named ? { pub_url: "https://www.pint-prices.com/pub/1" } : {}),
    ...(observedAt ? { scraped_at_values: observedAt } : {}),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("comparatorEvidenceFor: evidence for the printed price, or none", () => {
  it("never lends a named row at another price to the printed one", () => {
    // A named row at £5.10 and an unnamed row at the printed £6.75.
    const evidence = comparatorEvidenceFor({ priceGbp: 6.75, prices: [row(5.1, true), row(6.75, false)] });
    expect(evidence).not.toBe("unavailable");
    expect(evidence === "unavailable" ? null : evidence.publisher).toBeNull();
  });

  it("names the publisher of the row that carries the printed price", () => {
    const evidence = comparatorEvidenceFor({ priceGbp: 6.75, prices: [row(5.1, false), row(6.75, true)] });
    expect(evidence === "unavailable" ? null : evidence.publisher?.label).toBe("Pint Prices");
  });

  it("is unavailable when no row carries the printed price at all", () => {
    expect(comparatorEvidenceFor({ priceGbp: 6.75, prices: [row(5.1, true)] })).toBe("unavailable");
  });
});

describe("readLandingEvidence: a read with a deadline", () => {
  it("ends a stalled read as unavailable at the deadline, and aborts its fetch", async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_ok, fail) => {
          init.signal?.addEventListener("abort", () => {
            aborted = true;
            fail(new DOMException("aborted", "AbortError"));
          });
        }),
      ),
    );
    const read = readLandingEvidence("venue-a", 6.75, new AbortController().signal, comparatorEvidenceFor);
    await vi.advanceTimersByTimeAsync(LANDING_EVIDENCE_DEADLINE_MS);
    await expect(read).resolves.toBe("unavailable");
    expect(aborted).toBe(true);
  });
});

describe("settleEachRead: each read lands on its own", () => {
  it("applies whichever read answers first, without waiting for the other", async () => {
    const primary = deferred<string>();
    const comparator = deferred<string>();
    const applied: string[] = [];
    settleEachRead(() => true, [
      { read: primary.promise, apply: (value) => applied.push(`primary:${value}`) },
      { read: comparator.promise, apply: (value) => applied.push(`comparator:${value}`) },
    ]);
    comparator.resolve("ok");
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toEqual(["comparator:ok"]);
    primary.resolve("ok");
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toEqual(["comparator:ok", "primary:ok"]);
  });

  it("drops a late result for an answer that has been replaced", async () => {
    const late = deferred<string>();
    let current = true;
    const applied: string[] = [];
    settleEachRead(() => current, [{ read: late.promise, apply: (value) => applied.push(value) }]);
    current = false;
    late.resolve("stale");
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toEqual([]);
  });
});
