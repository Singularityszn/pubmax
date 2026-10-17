import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const indexState = vi.hoisted(() => ({ delayMs: 0, fail: false }));

vi.mock("@/lib/venueIndex", () => ({
  getVenueIndex: async () => {
    if (indexState.fail) throw new Error("index unavailable");
    if (indexState.delayMs) await new Promise((resolve) => setTimeout(resolve, indexState.delayMs));
    return new Map([
      ["venue-crown", { id: "venue-crown", name: "The Crown", borough: "Westminster", lat: 51.5136, lng: -0.1318 }],
    ]);
  },
}));

import { __resetDiary, diaryStore } from "@/lib/diaryStore";
import { readPalTaste } from "@/lib/palTaste.server";
import type { RatingValue } from "@/lib/ratings";

async function logVisit(ownerUserId: string, visitedOn: string, rating: RatingValue | null): Promise<void> {
  const created = await diaryStore().create({
    ownerUserId,
    venueId: "venue-crown",
    venueName: "The Crown",
    visitedOn,
    rating,
    review: "",
    visibility: "private",
  });
  expect(created.status).toBe("created");
}

describe("readPalTaste", () => {
  afterEach(() => {
    __resetDiary();
    indexState.delayMs = 0;
    indexState.fail = false;
  });

  it("reads only the owner's own diary, by account id", async () => {
    await logVisit("owner-a", "2026-10-02", 4.5);
    await logVisit("owner-b", "2026-10-03", 1);

    const taste = await readPalTaste("owner-a", 1_000);

    expect(taste).toMatchObject({ visits: 1, loved: ["The Crown"], notKeen: [], lastVisit: { name: "The Crown" } });
    expect(await readPalTaste("owner-nobody", 1_000)).toBeNull();
  });

  it("answers null instead of rejecting when a store fails", async () => {
    indexState.fail = true;
    await logVisit("owner-fail", "2026-10-02", 4);
    await expect(readPalTaste("owner-fail", 1_000)).resolves.toBeNull();
  });

  it("answers null past its budget, then serves the late read from the cache", async () => {
    indexState.delayMs = 1_200;
    await logVisit("owner-slow", "2026-10-02", 5);

    expect(await readPalTaste("owner-slow", 1_000)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await readPalTaste("owner-slow", 1_000)).toMatchObject({ visits: 1, loved: ["The Crown"] });
  });
});
