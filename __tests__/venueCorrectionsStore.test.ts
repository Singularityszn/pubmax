import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetVenueCorrections,
  memoryVenueCorrectionsStore as store,
} from "@/lib/venueCorrectionsStore";
import { validateVenueCorrection, VENUE_CORRECTION_NOTE_MAX } from "@/lib/venueCorrections";

const ALICE = "a1111111-1111-4111-8111-111111111111";
const BOB = "b1111111-1111-4111-8111-111111111111";

beforeEach(() => {
  __resetVenueCorrections();
});

describe("venue corrections store (memory)", () => {
  it("round trips a note: created open, read back in the queue, decided once", async () => {
    const created = await store.create(
      { venueId: "venue-crown", kind: "closed", note: "Boarded up since May.", ownerUserId: ALICE },
      Date.parse("2026-10-30T20:00:00Z"),
    );
    expect(created).toMatchObject({
      venueId: "venue-crown",
      kind: "closed",
      note: "Boarded up since May.",
      ownerUserId: ALICE,
      status: "open",
      createdAt: "2026-10-30T20:00:00.000Z",
      resolvedAt: null,
      resolvedBy: null,
    });

    expect((await store.listForReview("open")).map((row) => row.id)).toEqual([created.id]);
    expect(await store.getById(created.id)).toEqual(created);

    expect(await store.decide(created.id, "resolved", "admin", Date.parse("2026-10-31T09:00:00Z"))).toBe(true);
    const decided = await store.getById(created.id);
    expect(decided).toMatchObject({ status: "resolved", resolvedBy: "admin", resolvedAt: "2026-10-31T09:00:00.000Z" });
    expect(await store.listForReview("open")).toEqual([]);
    expect((await store.listForReview("resolved")).map((row) => row.id)).toEqual([created.id]);

    // A second verdict on a decided note is a no-op, not a flip.
    expect(await store.decide(created.id, "dismissed", "admin")).toBe(false);
    expect((await store.getById(created.id))?.status).toBe("resolved");
  });

  it("lists the queue newest first and an owner's own rows only", async () => {
    const older = await store.create({ venueId: "venue-a", kind: "hours", note: "", ownerUserId: ALICE }, 1_000);
    const newer = await store.create({ venueId: "venue-b", kind: "other", note: "", ownerUserId: BOB }, 2_000);
    expect((await store.listForReview("open")).map((row) => row.id)).toEqual([newer.id, older.id]);
    const alice = await store.listForOwner(ALICE);
    expect(alice.status).toBe("ready");
    expect(alice.corrections.map((row) => row.id)).toEqual([older.id]);
  });

  it("an unknown id decides nothing", async () => {
    expect(await store.decide("00000000-0000-4000-8000-000000000000", "dismissed", "admin")).toBe(false);
  });
});

describe("validateVenueCorrection", () => {
  it("admits the closed set and a short note, cleaned to one line", () => {
    expect(validateVenueCorrection({ venueId: "venue-crown", kind: "hours", note: "  Shuts at 10\n now " })).toEqual({
      ok: true,
      venueId: "venue-crown",
      kind: "hours",
      note: "Shuts at 10 now",
    });
  });

  it("refuses an unknown kind, a missing venue and a note over the limit rather than trimming it", () => {
    expect(validateVenueCorrection({ venueId: "venue-crown", kind: "rude-barman" })).toMatchObject({ ok: false, field: "kind" });
    expect(validateVenueCorrection({ kind: "closed" })).toMatchObject({ ok: false, field: "venueId" });
    expect(
      validateVenueCorrection({ venueId: "venue-crown", kind: "other", note: "x".repeat(VENUE_CORRECTION_NOTE_MAX + 1) }),
    ).toMatchObject({ ok: false, field: "note" });
    expect(
      validateVenueCorrection({ venueId: "venue-crown", kind: "other", note: "x".repeat(VENUE_CORRECTION_NOTE_MAX) }),
    ).toMatchObject({ ok: true });
  });
});
