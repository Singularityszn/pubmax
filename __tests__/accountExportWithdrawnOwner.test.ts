// A withdrawn account is hidden from the PUBLIC, never from itself. The export
// reads the owner's Pint Drops through the same store seam that withdraws an
// author from every public read, and its visit reports through the owner-only
// lane, so a suspended owner's export must still hold every drop and report
// they logged rather than a "complete" empty lane.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  __resetMemoryProfileWithdrawals,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { buildAccountExport } from "@/lib/accountExport.server";
import { __resetPintDrops, addPintDrop } from "@/lib/pintDrops";
import { memoryPintDropStore } from "@/lib/pintDropsStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { __resetMemorySavedPubs, memorySavedPubsStore, savedPubsStore } from "@/lib/savedPubsStore";
import { __resetVisitReports, memoryVisitReportStore } from "@/lib/visitReportsStore";

afterEach(() => {
  __resetMemoryProfileWithdrawals();
  __resetMemoryProfiles();
  __resetPintDrops();
  __resetVisitReports();
  __resetMemorySavedPubs();
});

describe("account export for a withdrawn owner", () => {
  it.each([false, true])("exports the owner's saves when withdrawn is %s without exposing another account's saves", async (withdrawn) => {
    const profile = __seedMemoryOwnedProfile("save_owner", "user-save-owner");
    __setMemoryProfileWithdrawn(profile.id, withdrawn);
    await memorySavedPubsStore.toggleSaved({
      handle: "save_owner",
      venueId: "the-crown",
      listType: "Favourites",
    });

    const publicRead = await savedPubsStore().readSaved({ handle: "save_owner" });
    expect(publicRead).toMatchObject({ status: "ready", rows: withdrawn ? [] : [expect.objectContaining({ venueId: "the-crown" })] });

    const exported = await buildAccountExport("user-save-owner");
    expect(exported.savedPubs).toMatchObject({
      status: "complete",
      items: [expect.objectContaining({ venueId: "the-crown", listType: "Favourites" })],
    });
    expect((await buildAccountExport("another-account")).savedPubs.items).toEqual([]);
  });

  it("keeps the owner's own drops and visit reports while the public read hides them", async () => {
    const profile = __seedMemoryOwnedProfile("karansdad", "user-karansdad");
    __setMemoryProfileWithdrawn(profile.id, true);
    addPintDrop({
      id: "own-drop",
      venueId: "the-crown",
      handle: "karansdad",
      drink: "",
      priceGbp: 4.2,
      passedDownNote: "",
      era: "",
      provenance: "contributor",
      status: "visible",
      createdAt: "2026-09-01T20:00:00.000Z",
    });
    await memoryVisitReportStore.create(
      {
        venueId: "the-crown",
        handle: "karansdad",
        visitedAt: "2026-09-01",
        busyness: "steady",
        noise: null,
        seating: null,
        serviceWait: null,
        note: "",
      },
      1_000,
    );

    expect(await memoryPintDropStore.listVisible("the-crown")).toEqual([]);
    expect((await memoryVisitReportStore.readForVenue("the-crown")).reports).toEqual([]);

    const exported = await buildAccountExport("user-karansdad");
    expect(exported.pintDrops).toMatchObject({ status: "complete" });
    expect(exported.pintDrops.items.map((drop) => drop.id)).toEqual(["own-drop"]);
    expect(exported.visitReports).toMatchObject({ status: "complete" });
    expect(exported.visitReports.items.map((report) => report.handle)).toEqual(["karansdad"]);
  });
});
