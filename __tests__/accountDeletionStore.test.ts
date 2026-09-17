import { beforeEach, describe, expect, it, vi } from "vitest";

// `deleteOwnAccount` — the ONE writer behind account deletion.
//
// THREE PHASES in ONE order: the object keys are COLLECTED (the wall photo rows
// and the message columns NAME half of them and the trigger clears those rows,
// so the read has to come first), then the auth row goes and migration `0078`'s
// trigger (as restated by `0145` and `0150`) owns everything downstream, and
// only then are the objects REMOVED. The order is the point, and it is the
// reverse of the first cut: a failure before the auth row goes removes NOTHING,
// so a person who taps Delete, is told to try again and decides not to still has
// every photo they ever uploaded (review finding F-5). The answer is THREE-WAY:
// an account that is already gone is a success, while a delete we could not run
// is a failure the reader may retry.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({
  requireSupabaseAdmin: () => {
    throw new Error("the default deps must not be reached by this file");
  },
  STORAGE_BUCKET: "pint-drops",
}));
vi.mock("@/lib/profileStore", () => ({
  profileStore: () => {
    throw new Error("the default deps must not be reached by this file");
  },
}));

const logged = vi.hoisted(() => ({ events: [] as Array<{ event: string; stage?: unknown }> }));
vi.mock("@/lib/log", () => ({
  log: (_level: string, event: string, context?: Record<string, unknown>) => {
    logged.events.push({ event, stage: context?.stage });
  },
}));

import { accountIsDeleted } from "@/lib/accountDeletion";
import {
  deleteOwnAccount,
  ownedObjectKeys,
  type AccountDeletionDeps,
} from "@/lib/accountDeletion.server";

const USER = "u0000000-0000-4000-8000-000000000001";
const PROFILE = "p0000000-0000-4000-8000-000000000002";
const MEMORY = "m0000000-0000-4000-8000-000000000003";

type Fake = AccountDeletionDeps & {
  bucket: Set<string>;
  removed: string[][];
  authDeleted: string[];
  authError: { status?: number; code?: string; message?: string } | null;
  authThrows: unknown;
  listThrows: string | null;
  rowsThrow: boolean;
  removeThrows: boolean;
  profile: { id: string; handle: string } | null;
  wallKeys: string[];
  messageKeys: string[];
  messageKeysAskedWith: Array<[string, string]>;
};

/** A bucket that lists by folder the way the Storage API does, and an auth that answers as GoTrue does. */
function fakeDeps(): Fake {
  const fake: Fake = {
    bucket: new Set<string>(),
    removed: [],
    authDeleted: [],
    authError: null,
    authThrows: null,
    listThrows: null,
    rowsThrow: false,
    removeThrows: false,
    profile: { id: PROFILE, handle: "night_owl" },
    wallKeys: [],
    messageKeys: [],
    messageKeysAskedWith: [],
    async profileForUser() {
      return fake.profile;
    },
    async listObjectKeys(folder) {
      if (fake.listThrows && folder.startsWith(fake.listThrows)) {
        throw new Error(`could not list ${folder}`);
      }
      return [...fake.bucket].filter((key) => key.startsWith(`${folder}/`));
    },
    async wallPhotoKeys() {
      if (fake.rowsThrow) throw new Error("venue_photos unreadable");
      return fake.wallKeys;
    },
    async messagePhotoKeys(profileId, handle) {
      fake.messageKeysAskedWith.push([profileId, handle]);
      if (fake.rowsThrow) throw new Error("messages unreadable");
      return fake.messageKeys;
    },
    async removeObjects(keys) {
      if (fake.removeThrows) throw new Error("storage refused");
      fake.removed.push([...keys]);
      for (const key of keys) fake.bucket.delete(key);
    },
    async deleteAuthUser(userId) {
      if (fake.authThrows) throw fake.authThrows;
      fake.authDeleted.push(userId);
      return { error: fake.authError };
    },
  };
  return fake;
}

function seedPhotos(fake: Fake): string[] {
  const avatar = `avatars/${PROFILE}/gen1/avatar.jpg`;
  const cover = `covers/${PROFILE}/gen2/cover.jpg`;
  const moment = `night-moments/${USER}/${MEMORY}/photo.jpg`;
  const wall = "venue-photos/venue-1/photo-1.jpg";
  const wallStaging = "venue-photos/venue-1/photo-1.staging.jpg";
  const message = "messages/conv-1/msg-1.jpg";
  const stranger = `night-moments/other-user/${MEMORY}/photo.jpg`;
  for (const key of [avatar, cover, moment, wall, wallStaging, message, stranger]) {
    fake.bucket.add(key);
  }
  fake.wallKeys = [wall];
  fake.messageKeys = [message];
  return [avatar, cover, moment, wall, wallStaging, message];
}

beforeEach(() => {
  logged.events = [];
});

describe("ownedObjectKeys", () => {
  it("collects the folders and the row-named keys, with each serving key's staging twin", async () => {
    const fake = fakeDeps();
    const owned = seedPhotos(fake);

    const keys = await ownedObjectKeys(USER, fake);

    expect([...keys].sort()).toEqual(
      [...owned, "messages/conv-1/msg-1.staging.jpg"].sort(),
    );
    // Another account's Moment photo is not this account's to delete.
    expect(keys).not.toContain(`night-moments/other-user/${MEMORY}/photo.jpg`);
  });

  it("asks for message photos by PROFILE as well as by handle", async () => {
    // Review finding F-4: `sender_handle` is text stamped at send time and a
    // rename does not rewrite it, so a handle-only read left every photo an
    // account sent under an older handle in the bucket. Migration `0151` is
    // what put the un-renameable identity on the row.
    const fake = fakeDeps();
    seedPhotos(fake);

    await ownedObjectKeys(USER, fake);

    expect(fake.messageKeysAskedWith).toEqual([[PROFILE, "night_owl"]]);
  });

  it("walks only the Moment folder for an account that never claimed a handle", async () => {
    const fake = fakeDeps();
    fake.profile = null;
    const moment = `night-moments/${USER}/${MEMORY}/photo.jpg`;
    fake.bucket.add(moment);
    fake.rowsThrow = true; // no profile, so no row read may even be attempted

    expect(await ownedObjectKeys(USER, fake)).toEqual([moment]);
  });
});

describe("deleteOwnAccount", () => {
  it("deletes the auth row, then removes the account's objects through the Storage API", async () => {
    const fake = fakeDeps();
    const owned = seedPhotos(fake);

    const outcome = await deleteOwnAccount(USER, fake);

    expect(outcome).toBe("deleted");
    expect(fake.removed.flat().sort()).toEqual(
      [...owned, "messages/conv-1/msg-1.staging.jpg"].sort(),
    );
    expect(fake.authDeleted).toEqual([USER]);
    // The stranger's photo is untouched.
    expect(fake.bucket.has(`night-moments/other-user/${MEMORY}/photo.jpg`)).toBe(true);
    expect(logged.events).toEqual([]);
  });

  it("deletes an account that never onboarded and owns nothing, with no removal call", async () => {
    const fake = fakeDeps();
    fake.profile = null;

    expect(await deleteOwnAccount(USER, fake)).toBe("deleted");
    expect(fake.removed).toEqual([]);
    expect(fake.authDeleted).toEqual([USER]);
  });

  it("reads an account that is already gone as a success", async () => {
    const fake = fakeDeps();
    fake.authError = { status: 404, code: "user_not_found", message: "User not found" };

    const outcome = await deleteOwnAccount(USER, fake);

    expect(outcome).toBe("already-gone");
    expect(accountIsDeleted(outcome)).toBe(true);
    // Not an outage, so nothing is logged as one.
    expect(logged.events).toEqual([]);
  });

  it("reads a message-only not-found the same way", async () => {
    const fake = fakeDeps();
    fake.authError = { message: "User not found" };

    expect(await deleteOwnAccount(USER, fake)).toBe("already-gone");
  });

  it("refuses before removing anything when the objects could not be listed", async () => {
    // A delete that removed what it could see and left what it could not is
    // not a deletion. Nothing is removed and the auth row stays.
    const fake = fakeDeps();
    seedPhotos(fake);
    fake.listThrows = `night-moments/${USER}`;

    const outcome = await deleteOwnAccount(USER, fake);

    expect(outcome).toBe("unavailable");
    expect(accountIsDeleted(outcome)).toBe(false);
    expect(fake.removed).toEqual([]);
    expect(fake.authDeleted).toEqual([]);
    expect(logged.events).toEqual([{ event: "account.delete_failed", stage: "objects_unreadable" }]);
  });

  it("refuses before removing anything when the rows naming the objects could not be read", async () => {
    const fake = fakeDeps();
    seedPhotos(fake);
    fake.rowsThrow = true;

    expect(await deleteOwnAccount(USER, fake)).toBe("unavailable");
    expect(fake.removed).toEqual([]);
    expect(fake.authDeleted).toEqual([]);
  });

  it("keeps the account's photos when the auth delete could not run — F-5", async () => {
    // THE REGRESSION. The first cut removed every object BEFORE the auth
    // delete, so an auth failure answered "Your account could not be deleted.
    // Try again." over a live account whose avatar, covers, Moments and pub
    // wall photos were already irreversibly gone, with the wall rows still on
    // public walls as broken images.
    const fake = fakeDeps();
    const owned = seedPhotos(fake);
    fake.authError = { status: 500, message: "database unavailable" };

    const outcome = await deleteOwnAccount(USER, fake);

    expect(outcome).toBe("unavailable");
    expect(accountIsDeleted(outcome)).toBe(false);
    expect(fake.removed).toEqual([]);
    for (const key of owned) expect(fake.bucket.has(key)).toBe(true);
    expect(logged.events).toEqual([{ event: "account.delete_failed", stage: "auth" }]);
  });

  it("survives a throwing auth client rather than taking the route down, and removes nothing", async () => {
    const fake = fakeDeps();
    const owned = seedPhotos(fake);
    fake.authThrows = new Error("network down");

    expect(await deleteOwnAccount(USER, fake)).toBe("unavailable");
    expect(fake.removed).toEqual([]);
    for (const key of owned) expect(fake.bucket.has(key)).toBe(true);
    expect(logged.events).toEqual([{ event: "account.delete_failed", stage: "auth" }]);
  });

  it("stays deleted when the Storage API refused the removal, and names the orphans", async () => {
    // The account is gone; saying it is not would be the same lie in mirror
    // image. The bytes nobody could remove are logged for an operator sweep,
    // and no product surface can serve one: the trigger has already deleted
    // the wall rows and cleared the message columns that named them.
    const fake = fakeDeps();
    seedPhotos(fake);
    fake.removeThrows = true;

    const outcome = await deleteOwnAccount(USER, fake);

    expect(outcome).toBe("deleted");
    expect(fake.authDeleted).toEqual([USER]);
    expect(logged.events).toEqual([
      { event: "account.delete_objects_orphaned", stage: "objects_not_removed" },
    ]);
  });

  it("removes the folder-walked objects on a retry after a removal that failed", async () => {
    // The first attempt deleted the auth row and could not reach Storage. The
    // retry reads `already-gone`, and the folder walk still lists the avatar,
    // the cover and the Moment photo by PREFIX, so they leave on the second go.
    const fake = fakeDeps();
    seedPhotos(fake);
    fake.removeThrows = true;
    expect(await deleteOwnAccount(USER, fake)).toBe("deleted");

    fake.removeThrows = false;
    // The trigger cleared the rows that named the wall and message photos.
    fake.wallKeys = [];
    fake.messageKeys = [];
    fake.authError = { status: 404, code: "user_not_found" };
    expect(await deleteOwnAccount(USER, fake)).toBe("already-gone");

    expect([...fake.bucket].sort()).toEqual(
      [
        `night-moments/other-user/${MEMORY}/photo.jpg`,
        "venue-photos/venue-1/photo-1.jpg",
        "venue-photos/venue-1/photo-1.staging.jpg",
        "messages/conv-1/msg-1.jpg",
      ].sort(),
    );
  });

  it("never reaches the seam for an empty id", async () => {
    const fake = fakeDeps();

    expect(await deleteOwnAccount("   ", fake)).toBe("unavailable");
    expect(fake.authDeleted).toEqual([]);
    expect(fake.removed).toEqual([]);
  });
});
