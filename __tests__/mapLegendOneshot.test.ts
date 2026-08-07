import { describe, expect, it } from "vitest";

import {
  MAP_LEGEND_ONESHOT_KEY,
  hasConsumedMapLegendOneshot,
  markMapLegendOneshotConsumed,
  shouldAutoOpenMapLegendOneshot,
} from "@/lib/mapLegendOneshot";
import { ANALYTICS_CONSENT_STORAGE_KEY } from "@/lib/analyticsIdentity";

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

describe("map legend oneshot", () => {
  it("marks and reads the session gate", () => {
    const storage = makeMemoryStorage();
    expect(hasConsumedMapLegendOneshot(storage)).toBe(false);
    markMapLegendOneshotConsumed(storage);
    expect(hasConsumedMapLegendOneshot(storage)).toBe(true);
    expect(storage.getItem(MAP_LEGEND_ONESHOT_KEY)).toBe("1");
  });

  it("refuses when consent is undecided or oneshot is already consumed", () => {
    const storage = makeMemoryStorage();
    const consent = makeMemoryStorage();
    expect(
      shouldAutoOpenMapLegendOneshot({
        storage,
        consentStorage: consent,
        hasExplicitIntent: false,
      }),
    ).toBe(false);
    consent.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "denied");
    markMapLegendOneshotConsumed(storage);
    expect(
      shouldAutoOpenMapLegendOneshot({
        storage,
        consentStorage: consent,
        hasExplicitIntent: false,
      }),
    ).toBe(false);
  });

  it("refuses explicit map arrivals", () => {
    const storage = makeMemoryStorage();
    const consent = makeMemoryStorage();
    consent.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "granted");
    expect(
      shouldAutoOpenMapLegendOneshot({
        storage,
        consentStorage: consent,
        hasExplicitIntent: true,
      }),
    ).toBe(false);
  });
});
