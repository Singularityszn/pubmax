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
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import * as pubPalStore from "@/lib/pubPalStore";
import type { RatingValue } from "@/lib/ratings";
import { profileStore } from "@/lib/profileStore";

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
  it("uses the owner's declared favourite drink without borrowing another handle's profile", async () => {
    const handles = vi.spyOn(profileStore(), "getHandleByUserId").mockImplementation(async (ownerId) => ownerId === "owner-profile" ? "own-profile" : null);
    const profiles = vi.spyOn(profileStore(), "getByHandle").mockResolvedValue({ id: "profile-1", handle: "own-profile", userId: "owner-profile", favouriteDrink: "Gin and beer", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" });
    expect(await readPalTaste("owner-profile", 1_000)).toMatchObject({ declaredDrink: "Gin and beer", visits: 0 });
    expect(profiles).toHaveBeenCalledWith("own-profile");
    handles.mockResolvedValue("someone-else");
    expect(await readPalTaste("owner-mismatch", 1_000)).toBeNull();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    pubPalStore.__resetPubPalStore();
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

  it("reads nothing for an owner who turned the taste read off, even past a cached read", async () => {
    await logVisit("owner-off", "2026-10-02", 5);
    expect((await pubPalStore.createPubPalResult("owner-off", { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Moss" })).ok).toBe(true);
    expect(await readPalTaste("owner-off", 1_000)).toMatchObject({ visits: 1 });

    expect((await pubPalStore.updatePubPalResult("owner-off", { proposalPreferences: { taste: false } })).ok).toBe(true);
    const listForOwner = vi.spyOn(diaryStore(), "listForOwner");
    expect(await readPalTaste("owner-off", 1_000)).toBeNull();
    expect(await readPalTaste("owner-off", 2_000)).toBeNull();
    expect(listForOwner).not.toHaveBeenCalled();

    expect((await pubPalStore.updatePubPalResult("owner-off", { proposalPreferences: { taste: true } })).ok).toBe(true);
    expect(await readPalTaste("owner-off", 3_000)).toMatchObject({ visits: 1 });
  });

  it("fails closed when the Pal's setting cannot be read", async () => {
    await logVisit("owner-unknown", "2026-10-02", 5);
    vi.spyOn(pubPalStore, "getPubPalResult").mockResolvedValue({ ok: false, error: "error" });
    expect(await readPalTaste("owner-unknown", 1_000)).toBeNull();
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

  it("deletes a cached read two minutes after it lands, even when the owner never asks again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await logVisit("owner-quiet", "2026-10-02", 5);
      expect(await readPalTaste("owner-quiet", 1_000)).toMatchObject({ visits: 1 });

      // With every store failing, only the cache can answer. The same `now`
      // keeps the read-time age check out of it, so this is the timer alone.
      indexState.fail = true;
      vi.advanceTimersByTime(119_000);
      expect(await readPalTaste("owner-quiet", 1_000)).toMatchObject({ visits: 1 });
      vi.advanceTimersByTime(1_000);
      expect(await readPalTaste("owner-quiet", 1_000)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
