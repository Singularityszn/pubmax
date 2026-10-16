// A REPEATED QUERY KEY IS NOT A 500 (review finding PAGE-7). Next hands
// `?sub=a&sub=b` to the page as an array, and the page passed it straight to a
// helper that called `.trim()` on it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  load: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: io.redirect,
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/lib/drinkSubtypePricedView.server", () => ({ loadSoftDrinksWaterView: io.load }));
vi.mock("@/components/drinks/DrinkSubtypePricedView", () => ({
  default: () => null,
  DEFAULT_SOFT_DRINKS_WATER_LAUNCH_IDS: [],
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/drinks/drinkSubtypePricedView.css", () => ({}));

import SoftDrinksAndWaterPage from "@/app/soft-drinks-and-water/page";

beforeEach(() => {
  io.load.mockReset();
  io.redirect.mockClear();
  io.load.mockImplementation(async (subtypeId: string) => ({
    subtypeId,
    rows: [],
    observedCounts: {},
  }));
});

describe("/soft-drinks-and-water with a repeated ?sub=", () => {
  it("reads the first value rather than throwing", async () => {
    await expect(
      SoftDrinksAndWaterPage({
        searchParams: Promise.resolve({
          sub: ["soft-drink-still-water", "soft-drink-zero-sugar-cola"],
        }),
      }),
    ).resolves.toBeTruthy();
    expect(io.load).toHaveBeenCalledWith("soft-drink-still-water");
  });

  it("still reads a single value", async () => {
    await SoftDrinksAndWaterPage({
      searchParams: Promise.resolve({ sub: "soft-drink-still-water" }),
    });
    expect(io.load).toHaveBeenCalledWith("soft-drink-still-water");
  });
});
