import { describe, expect, it, vi, beforeEach } from "vitest";

// Capture the TTL passed to Supabase's createSignedUrl so we can assert the
// public recap path signs with a SHORT lifetime (R2: signed URLs can't be
// revoked, so a withdrawn consent must not stay fetchable for an hour).
const createSignedUrl = vi.fn(async (key: string) => ({
  data: { signedUrl: `https://cdn.test/signed/${key}` },
  error: null,
}));

const removedKeys: string[] = [];
const uploads: Array<{ folder: string; id: string }> = [];

vi.mock("@/lib/supabase", () => ({
  requireSupabaseAdmin: () => ({ storage: { from: () => ({ createSignedUrl }) } }),
  isSupabaseConfigured: () => true,
  STORAGE_BUCKET: "pint-drops",
}));
vi.mock("@/lib/pintDropsStore", () => ({
  deletePhotos: async (keys: string[]) => {
    removedKeys.push(...keys);
  },
  uploadPhoto: async (_slot: string, folder: string, id: string) => {
    uploads.push({ folder, id });
    return `${folder}/${id}/venue.jpg`;
  },
}));

import { ownedObjectFolders } from "@/lib/accountOwnedObjects";
import {
  NIGHT_MOMENT_PHOTO_TTL_SECONDS,
  PUBLIC_RECAP_PHOTO_TTL_SECONDS,
  removeNightMomentPhoto,
  signedNightMomentPhotoUrl,
  uploadNightMomentPhoto,
} from "@/lib/nightMomentMedia";

const OWNER = "o";
const OWNED = "night-moments/o/m/x.jpg";

describe("signedNightMomentPhotoUrl TTL", () => {
  beforeEach(() => {
    createSignedUrl.mockClear();
    removedKeys.length = 0;
  });

  it("keeps the owner-facing default at one hour", () => {
    expect(NIGHT_MOMENT_PHOTO_TTL_SECONDS).toBe(3600);
  });

  it("signs owner surfaces with the long default when no TTL is passed", async () => {
    await signedNightMomentPhotoUrl(OWNED, OWNER);
    expect(createSignedUrl).toHaveBeenCalledWith(OWNED, 3600);
  });

  it("exposes a short public-recap TTL well under the default", () => {
    expect(PUBLIC_RECAP_PHOTO_TTL_SECONDS).toBe(180);
    expect(PUBLIC_RECAP_PHOTO_TTL_SECONDS).toBeLessThan(NIGHT_MOMENT_PHOTO_TTL_SECONDS);
  });

  it("the public recap path requests the short TTL, bounding withdrawn-consent exposure", async () => {
    await signedNightMomentPhotoUrl(OWNED, OWNER, PUBLIC_RECAP_PHOTO_TTL_SECONDS);
    expect(createSignedUrl).toHaveBeenCalledWith(OWNED, 180);
  });

  it("returns null for a missing key without signing", async () => {
    expect(await signedNightMomentPhotoUrl(null, OWNER)).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("does not sign or delete a key outside the owner's Night Moment prefix", async () => {
    const foreign = [
      "avatars/profile-1/photo.jpg",
      "messages/conversation-1/photo.jpg",
      "venue-1/drop-1/receipt.jpg",
      "night-moments/o/../../avatars/photo.jpg",
      "night-moments/someone-else/m/photo.jpg",
      "night-moments/o/%2e%2e/avatars/photo.jpg",
    ];
    for (const key of foreign) {
      expect(await signedNightMomentPhotoUrl(key, OWNER)).toBeNull();
      await removeNightMomentPhoto(key, OWNER);
    }
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(removedKeys).toEqual([]);

    expect(await signedNightMomentPhotoUrl(OWNED, OWNER)).toContain(OWNED);
    await removeNightMomentPhoto(OWNED, OWNER);
    expect(removedKeys).toEqual([OWNED]);
  });
});

describe("uploadNightMomentPhoto", () => {
  it("writes under the folder account deletion walks, so the photo leaves with the account", async () => {
    // D09: the photo bytes survived deletion because the upload path and the
    // deletion walk named two different folders.
    uploads.length = 0;
    const key = await uploadNightMomentPhoto(OWNER, "memory-1", new File([new Uint8Array(8)], "moment.jpg"));
    const [upload] = uploads;
    const walked = ownedObjectFolders({ userId: OWNER, profileId: null });
    expect(upload?.folder.startsWith("night-moments/")).toBe(true);
    expect(walked.some((folder) => `${upload?.folder}/`.startsWith(`${folder}/`))).toBe(true);
    expect(walked.some((folder) => key.startsWith(`${folder}/`))).toBe(true);
    expect(await signedNightMomentPhotoUrl(key, OWNER)).toContain(key);
  });
});
