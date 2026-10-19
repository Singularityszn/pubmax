// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import VenuePintNeedle from "@/components/map/VenuePintNeedle";
import { pintNeedleAngle, pintNeedleArc, pintNeedlePoint, pintNeedlePosition } from "@/components/map/pintNeedle";
import { priceBand, priceBandAreaForVenue, priceBandThresholdsFor } from "@/lib/priceBand";
import { DEFAULT_PAL_DRAFT, type PubPal } from "@/lib/pubPal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONDON_PUB = "venue-xjf3n0";
const THRESHOLDS = { cheapMaxGbp: 5.5, averageMaxGbp: 6.5, sampleSize: 900 };

function pal(overrides: Partial<PubPal> = {}): PubPal {
  const now = "2026-10-04T12:00:00.000Z";
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: "owner", name: "Ripley", adultAttestedAt: now,
    appearance: DEFAULT_PAL_DRAFT.appearance, personality: DEFAULT_PAL_DRAFT.personality, voice: DEFAULT_PAL_DRAFT.voice,
    muted: false, hidden: false, proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
    ...overrides,
  } as PubPal;
}

let root: Root | null = null;
let host: HTMLElement;

async function render(priceGbp: number | null) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(VenuePintNeedle, { venueId: LONDON_PUB, priceGbp }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});

describe("where the needle points", () => {
  it("gives each band a third of the dial, cut at the city's own two prices", () => {
    expect(pintNeedlePosition(5.5, THRESHOLDS)).toBeCloseTo(1 / 3);
    expect(pintNeedlePosition(6.5, THRESHOLDS)).toBeCloseTo(2 / 3);
    expect(pintNeedlePosition(6.0, THRESHOLDS)).toBeCloseTo(0.5);
    expect(pintNeedlePosition(5.0, THRESHOLDS)).toBeCloseTo(1 / 6);
    expect(pintNeedlePosition(7.0, THRESHOLDS)).toBeCloseTo(5 / 6);
  });

  it("never lies flat on either end", () => {
    expect(pintNeedlePosition(1, THRESHOLDS)).toBeGreaterThan(0);
    expect(pintNeedlePosition(40, THRESHOLDS)).toBeLessThan(1);
  });

  it("points into the same band the pin is painted, at every price", () => {
    const thresholds = priceBandThresholdsFor(priceBandAreaForVenue(LONDON_PUB));
    for (let pence = 250; pence <= 1200; pence += 5) {
      const price = pence / 100;
      const band = priceBand(price, priceBandAreaForVenue(LONDON_PUB));
      const position = pintNeedlePosition(price, thresholds);
      const third = band === "cheap" ? 0 : band === "average" ? 1 : 2;
      expect(position, `£${price.toFixed(2)} is ${band}`).toBeGreaterThanOrEqual(third / 3 - 1e-9);
      expect(position, `£${price.toFixed(2)} is ${band}`).toBeLessThanOrEqual((third + 1) / 3 + 1e-9);
    }
  });

  it("swings from straight left to straight right", () => {
    expect(pintNeedleAngle(0)).toBe(-90);
    expect(pintNeedleAngle(0.5)).toBe(0);
    expect(pintNeedleAngle(1)).toBe(90);
    const top = pintNeedlePoint(0.5, 100, 100, 78);
    expect(top.x).toBeCloseTo(100);
    expect(top.y).toBeCloseTo(22);
    expect(pintNeedleArc(0, 100, 100, 78).startsWith("M 22.00 100.00 A 78 78 0 0 1")).toBe(true);
  });
});

describe("the needle on a pub", () => {
  it("names the band and what it is measured against", async () => {
    const thresholds = priceBandThresholdsFor(priceBandAreaForVenue(LONDON_PUB));
    await render(thresholds.cheapMaxGbp - 0.4);
    const needle = host.querySelector("[data-testid='venue-pint-needle']")!;
    expect(needle.getAttribute("data-band")).toBe("cheap");
    expect(needle.classList.contains("priceBand-cheap")).toBe(true);
    expect(needle.querySelector(".venuePintNeedleBand")?.textContent).toBe("Cheap");
    expect(needle.querySelectorAll(".venuePintNeedleArc")).toHaveLength(3);
    expect(needle.querySelector("svg")?.getAttribute("aria-label")).toMatch(/^£\d+\.\d\d is cheap against /);
  });

  it("draws nothing without a pint", async () => {
    await render(null);
    expect(host.querySelector("[data-testid='venue-pint-needle']")).toBeNull();
  });

  it("seats the person's own Pal at the pivot, and hops it only for a cheap pint", async () => {
    window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify(pal()));
    const thresholds = priceBandThresholdsFor(priceBandAreaForVenue(LONDON_PUB));
    await render(thresholds.cheapMaxGbp - 0.4);
    expect(host.querySelector(".venuePintNeedlePal img")).not.toBeNull();
    expect(host.querySelector(".venuePintNeedlePal")!.classList.contains("isCheering")).toBe(true);
    act(() => root?.unmount());
    host.remove();

    await render(thresholds.averageMaxGbp + 0.6);
    expect(host.querySelector(".venuePintNeedlePal")!.classList.contains("isCheering")).toBe(false);
  });

  it("seats no Pal for a stranger or a hidden Pal", async () => {
    await render(5);
    expect(host.querySelector(".venuePintNeedlePal")).toBeNull();
    act(() => root?.unmount());
    host.remove();

    window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify(pal({ hidden: true })));
    await render(5);
    expect(host.querySelector(".venuePintNeedlePal")).toBeNull();
  });
});
