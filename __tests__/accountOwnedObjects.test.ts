import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// `lib/accountOwnedObjects.ts` — which Storage objects leave with an account.
//
// The bytes go through the Storage API (Supabase refuses a SQL delete on
// `storage.objects` and says the row-only delete orphans them), so the table
// of what an account owns is a pure module the writer and the tests share.
// What is pinned here: every per-account folder is named, the staging twin
// rule matches the one the tombstone trigger used, and the batch never
// exceeds what the Storage API accepts.

import {
  MAX_OWNED_OBJECTS,
  nightMomentObjectPrefix,
  ownedObjectFolders,
  ownedObjectKeysFromRows,
  removalBatches,
  stagingTwinOf,
  STORAGE_REMOVE_BATCH,
} from "@/lib/accountOwnedObjects";
import { PROFILE_IMAGE_SLOT_SPECS } from "@/lib/profileImageSlots";

const USER = "u0000000-0000-4000-8000-000000000001";
const PROFILE = "p0000000-0000-4000-8000-000000000002";

describe("ownedObjectFolders", () => {
  it("names every profile image slot's folder and the Moment folder, without a trailing slash", () => {
    const folders = ownedObjectFolders({ userId: USER, profileId: PROFILE });

    for (const slot of Object.values(PROFILE_IMAGE_SLOT_SPECS)) {
      expect(folders).toContain(`${slot.prefix}/${PROFILE}`);
    }
    expect(folders).toContain(`night-moments/${USER}`);
    expect(folders.every((folder) => !folder.endsWith("/"))).toBe(true);
    // Two slots plus the Moment folder: a slot added to the table joins here.
    expect(folders).toHaveLength(Object.keys(PROFILE_IMAGE_SLOT_SPECS).length + 1);
  });

  it("keeps the Moment folder for an account that never claimed a handle", () => {
    expect(ownedObjectFolders({ userId: USER, profileId: null })).toEqual([
      `night-moments/${USER}`,
    ]);
  });

  it("is the one owner of the Moment prefix the upload path writes under", () => {
    expect(nightMomentObjectPrefix(USER, "mem-1")).toBe(`night-moments/${USER}/mem-1`);
    expect(nightMomentObjectPrefix(USER)).toBe(`night-moments/${USER}`);

    // D09: the Moment photo bytes survived deletion because the upload path
    // and the tombstone named two different sets. The upload path reads the
    // prefix from here and types it nowhere.
    const media = readFileSync(join(process.cwd(), "lib/nightMomentMedia.ts"), "utf8");
    expect(media).toContain("nightMomentObjectPrefix(");
    expect(media).not.toContain("night-moments/");
  });
});

describe("stagingTwinOf", () => {
  it("names the staging object beside a serving key, the way the trigger's replace did", () => {
    expect(stagingTwinOf("venue-photos/venue-1/photo.jpg")).toBe(
      "venue-photos/venue-1/photo.staging.jpg",
    );
    expect(stagingTwinOf("messages/conv/msg.jpg")).toBe("messages/conv/msg.staging.jpg");
  });

  it("answers null for a staging key and for a key with no jpg tail", () => {
    expect(stagingTwinOf("messages/conv/msg.staging.jpg")).toBeNull();
    expect(stagingTwinOf("night-moments/u/m/photo.webp")).toBeNull();
  });
});

describe("ownedObjectKeysFromRows", () => {
  it("dedupes, drops blanks and adds each twin once", () => {
    expect(
      ownedObjectKeysFromRows([
        "a/x.jpg",
        " a/x.jpg ",
        null,
        undefined,
        "",
        "a/x.staging.jpg",
        "b/y.jpg",
      ]),
    ).toEqual(["a/x.jpg", "a/x.staging.jpg", "b/y.jpg", "b/y.staging.jpg"]);
  });
});

describe("removalBatches", () => {
  it("never hands the Storage API more than its limit in one call", () => {
    const keys = Array.from({ length: STORAGE_REMOVE_BATCH * 2 + 1 }, (_, i) => `k/${i}.jpg`);

    const batches = removalBatches(keys);

    expect(batches.map((batch) => batch.length)).toEqual([
      STORAGE_REMOVE_BATCH,
      STORAGE_REMOVE_BATCH,
      1,
    ]);
    expect(batches.flat()).toEqual(keys);
    expect(removalBatches([])).toEqual([]);
  });

  it("keeps the per-account ceiling above any batch, so a real account never trips it", () => {
    expect(MAX_OWNED_OBJECTS).toBeGreaterThan(STORAGE_REMOVE_BATCH);
  });
});
