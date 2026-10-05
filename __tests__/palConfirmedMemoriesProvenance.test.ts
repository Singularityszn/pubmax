import { describe, expect, it, vi } from "vitest";

import type { PubPalMemory } from "@/lib/pubPal";

const rows: PubPalMemory[] = [
  { id: "m1", palId: "p1", kind: "venue_preference", value: "Quiet back rooms", provenance: "user_confirmed", createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z" },
  { id: "m2", palId: "p1", kind: "night_outcome", value: "Inferred from a finished plan", provenance: "completed_plan", createdAt: "2026-10-02T10:00:00.000Z", updatedAt: "2026-10-02T10:00:00.000Z" },
  { id: "m3", palId: "p1", kind: "correction", value: "Not a fan of rooftop bars", provenance: "user_correction", createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-10-03T10:00:00.000Z" },
];

const storeState = vi.hoisted(() => ({ fail: false }));

vi.mock("@/lib/pubPalStore", () => ({
  listPalMemoriesResult: vi.fn(async () => {
    if (storeState.fail) throw new Error("store down");
    return { ok: true, value: rows };
  }),
}));

import { readConfirmedPalMemories } from "@/lib/palConfirmedMemories.server";

describe("which Pal memories may reach the model", () => {
  it("keeps only memories the person confirmed or corrected, newest edit first", async () => {
    storeState.fail = false;
    expect(await readConfirmedPalMemories("owner")).toEqual([
      { kind: "correction", label: "Correction", value: "Not a fan of rooftop bars" },
      { kind: "venue_preference", label: "Pubs", value: "Quiet back rooms" },
    ]);
  });

  it("reads as unavailable, not as no memories, when the store throws", async () => {
    storeState.fail = true;
    expect(await readConfirmedPalMemories("owner")).toBeNull();
  });
});
