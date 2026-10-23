import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

import type { DiaryEntryFields } from "@/lib/diary";
import { __resetDiary, diaryStore, memoryDiaryStore } from "@/lib/diaryStore";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function fields(overrides: Partial<DiaryEntryFields> = {}): DiaryEntryFields {
  return {
    ownerUserId: ALICE,
    venueId: "venue-dove",
    venueName: "The Dove",
    visitedOn: "2026-10-04",
    rating: 4.5,
    review: "Back room was calm.",
    visibility: "private",
    ...overrides,
  };
}

beforeEach(() => __resetDiary());
afterEach(() => vi.restoreAllMocks());

describe("diary store (memory backend)", () => {
  it("stores an entry with an id and a timestamp", async () => {
    const result = await memoryDiaryStore.create(fields(), Date.parse("2026-10-04T21:00:00Z"));
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.entry.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.entry.createdAt).toBe("2026-10-04T21:00:00.000Z");
    expect(result.entry).toMatchObject({ ownerUserId: ALICE, rating: 4.5, visibility: "private" });
  });

  it("refuses a second log of the same pub on the same day for the same owner", async () => {
    await memoryDiaryStore.create(fields());
    expect(await memoryDiaryStore.create(fields({ rating: 2 }))).toEqual({ status: "duplicate" });
    expect((await memoryDiaryStore.listForOwner(ALICE)).entries).toHaveLength(1);
  });

  it("allows the same pub on another day, another pub on the same day and another owner", async () => {
    await memoryDiaryStore.create(fields());
    expect((await memoryDiaryStore.create(fields({ visitedOn: "2026-10-05" }))).status).toBe("created");
    expect((await memoryDiaryStore.create(fields({ venueId: "venue-x" }))).status).toBe("created");
    expect((await memoryDiaryStore.create(fields({ ownerUserId: BOB }))).status).toBe("created");
  });

  it("lists only the owner's entries, newest visit day first", async () => {
    await memoryDiaryStore.create(fields({ visitedOn: "2026-10-01", venueId: "a" }));
    await memoryDiaryStore.create(fields({ visitedOn: "2026-10-05", venueId: "b" }));
    await memoryDiaryStore.create(fields({ ownerUserId: BOB, venueId: "c", review: "Bob's" }));
    const alice = await memoryDiaryStore.listForOwner(ALICE);
    expect(alice.status).toBe("ready");
    expect(alice.entries.map((entry) => entry.venueId)).toEqual(["b", "a"]);
    const bob = await memoryDiaryStore.listForOwner(BOB);
    expect(bob.entries.map((entry) => entry.review)).toEqual(["Bob's"]);
    expect((await memoryDiaryStore.listForOwner("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).entries).toEqual([]);
  });

  it("returns copies, so a caller cannot edit a stored entry", async () => {
    await memoryDiaryStore.create(fields());
    const first = (await memoryDiaryStore.listForOwner(ALICE)).entries[0]!;
    first.review = "tampered";
    expect((await memoryDiaryStore.listForOwner(ALICE)).entries[0]!.review).toBe("Back room was calm.");
  });

  it("corrects the owner's own entry in place and keeps what is not named", async () => {
    const created = await memoryDiaryStore.create(fields());
    if (created.status !== "created") throw new Error("expected a created entry");
    const result = await memoryDiaryStore.update(ALICE, created.entry.id, {
      rating: null,
      review: "Better.",
    });
    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(result.entry).toMatchObject({
      id: created.entry.id,
      rating: null,
      review: "Better.",
      visitedOn: "2026-10-04",
      venueId: "venue-dove",
    });
    expect((await memoryDiaryStore.listForOwner(ALICE)).entries[0]).toMatchObject({ review: "Better." });
  });

  it("refuses a correction onto a pub and day already logged, and another account's entry", async () => {
    await memoryDiaryStore.create(fields({ visitedOn: "2026-10-05" }));
    const created = await memoryDiaryStore.create(fields());
    if (created.status !== "created") throw new Error("expected a created entry");

    expect(await memoryDiaryStore.update(ALICE, created.entry.id, { visitedOn: "2026-10-05" })).toEqual({
      status: "duplicate",
    });
    expect(await memoryDiaryStore.update(BOB, created.entry.id, { review: "Mine" })).toEqual({
      status: "not_found",
    });
    // The same day, unchanged, is not a collision with itself.
    expect((await memoryDiaryStore.update(ALICE, created.entry.id, { visitedOn: "2026-10-04" })).status).toBe(
      "updated",
    );
  });

  it("removes only the owner's own entry", async () => {
    const created = await memoryDiaryStore.create(fields());
    if (created.status !== "created") throw new Error("expected a created entry");

    expect(await memoryDiaryStore.delete(BOB, created.entry.id)).toBe(false);
    expect((await memoryDiaryStore.listForOwner(ALICE)).entries).toHaveLength(1);
    expect(await memoryDiaryStore.delete(ALICE, created.entry.id)).toBe(true);
    expect(await memoryDiaryStore.delete(ALICE, created.entry.id)).toBe(false);
    expect((await memoryDiaryStore.listForOwner(ALICE)).entries).toEqual([]);
  });

  it("selects the memory backend when Supabase is not configured", async () => {
    expect((await diaryStore().create(fields())).status).toBe("created");
    expect((await diaryStore().listForOwner(ALICE)).entries).toHaveLength(1);
  });
});
