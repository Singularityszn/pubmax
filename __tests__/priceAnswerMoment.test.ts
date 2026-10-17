// The install ask waits for a price answer in THIS session (P2-C).

import { describe, expect, it } from "vitest";

import {
  PRICE_ANSWER_MOMENT_KEY,
  hasPriceAnswerThisSession,
  markPriceAnswerMoment,
  priceAnswerMoment,
} from "@/lib/priceAnswerMoment";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

describe("priceAnswerMoment", () => {
  it("starts with no answer", () => {
    const store = memoryStorage();
    expect(priceAnswerMoment(store)).toBeNull();
    expect(hasPriceAnswerThisSession(store)).toBe(false);
  });

  it("records the first answer and keeps it", () => {
    const store = memoryStorage();
    markPriceAnswerMoment("near-answer", store);
    markPriceAnswerMoment("venue-price", store);
    expect(priceAnswerMoment(store)).toBe("near-answer");
    expect(hasPriceAnswerThisSession(store)).toBe(true);
  });

  it("reads a word outside the closed set as no answer", () => {
    const store = memoryStorage();
    store.setItem(PRICE_ANSWER_MOMENT_KEY, "first-paint");
    expect(priceAnswerMoment(store)).toBeNull();
    markPriceAnswerMoment("first-paint" as never, store);
    expect(store.getItem(PRICE_ANSWER_MOMENT_KEY)).toBe("first-paint");
    expect(hasPriceAnswerThisSession(store)).toBe(false);
  });

  it("keeps waiting when storage cannot be read", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(() => markPriceAnswerMoment("venue-price", broken)).not.toThrow();
    expect(hasPriceAnswerThisSession(broken)).toBe(false);
    expect(hasPriceAnswerThisSession(null)).toBe(false);
  });
});
