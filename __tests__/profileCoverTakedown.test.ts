// A moderator's takedown of a cover must TAKE THE COVER DOWN.
//
// The admin console hides a cover by writing `profiles.cover_moderation_state`.
// The serve route used to treat that refusal as an invitation to ask the
// five-photo rotation instead, whose own row the admin lane never touched, so
// the hidden bytes kept answering 200 with a public, cacheable header. These
// cases pin both halves of the fix: a moderation decision is terminal on the
// serve path, and the decision is mirrored onto the rotation rows.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const supabaseConfigured = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => supabaseConfigured.value,
    requiresSupabaseStore: () => false,
  };
});

vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import {
  GET as serveCover,
  __setCoverServeRouteDepsForTest,
} from "@/app/api/cover/[profileId]/[generation]/route";
import { moderateProfileImageAcrossStores } from "@/lib/profileCoverModeration.server";
import {
  __resetProfileCoverPhotos,
  memoryProfileCoverPhotoStore,
} from "@/lib/profileCoverPhotoStore";
import { profileImageServingKey } from "@/lib/profileImageSlots";
import type { ProfileRecord } from "@/lib/profileStore";
import {
  __resetMemoryProfiles,
  __seedMemoryOwnedProfile,
  memoryProfileStore,
} from "@/lib/profileStore";

const HANDLE = "alice";
const PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const FIRST_GENERATION = "55555555-5555-4555-8555-555555555555";
const SECOND_GENERATION = "66666666-6666-4666-8666-666666666666";
const firstKey = profileImageServingKey("cover", PROFILE_ID, FIRST_GENERATION);
const secondKey = profileImageServingKey("cover", PROFILE_ID, SECOND_GENERATION);

const JPEG = {
  bytes: Buffer.from([0xff, 0xd8, 0xff]),
  contentType: "image/jpeg" as const,
};

/**
 * The profile row as the admin console leaves it after a hide: the mirror is
 * `hidden`, and the rotation - which nothing in the console names - is still
 * approved. That disagreement is the whole finding.
 */
function serveWith(coverModerationState: "approved" | "hidden"): void {
  supabaseConfigured.value = true;
  __setCoverServeRouteDepsForTest({
    getProfileById: async (): Promise<ProfileRecord> => ({
      id: PROFILE_ID,
      handle: HANDLE,
      userId: "user-alice",
      coverObjectKey: firstKey,
      coverGeneration: FIRST_GENERATION,
      coverModerationState,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    }),
    extraServingKey: (profileId, generation) =>
      memoryProfileCoverPhotoStore.approvedObjectKey(profileId, generation),
    downloadObject: async () => JPEG,
  });
}

async function seedRotation(): Promise<void> {
  await memoryProfileCoverPhotoStore.create({
    id: "77777777-7777-4777-8777-777777777771",
    profileId: PROFILE_ID,
    generation: FIRST_GENERATION,
    objectKey: firstKey,
  });
  await memoryProfileCoverPhotoStore.create({
    id: "77777777-7777-4777-8777-777777777772",
    profileId: PROFILE_ID,
    generation: SECOND_GENERATION,
    objectKey: secondKey,
  });
}

function serve(generation: string): Promise<Response> {
  return serveCover(new Request("http://localhost/x"), {
    params: Promise.resolve({ profileId: PROFILE_ID, generation }),
  });
}

beforeEach(async () => {
  __resetMemoryProfiles();
  __resetProfileCoverPhotos();
  await seedRotation();
});

afterEach(() => {
  supabaseConfigured.value = false;
});

describe("a hidden cover is not served out of the rotation", () => {
  it("serves the rotation normally while the cover is approved", async () => {
    serveWith("approved");
    expect((await serve(SECOND_GENERATION)).status).toBe(200);
  });

  it("refuses the MIRRORED generation once a moderator hid it", async () => {
    serveWith("hidden");
    const response = await serve(FIRST_GENERATION);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("refuses a rotation-only generation too, with the rotation row still approved", async () => {
    serveWith("hidden");
    // The rotation itself has not been told anything: this is the exact state
    // the admin lane used to leave behind.
    expect(
      await memoryProfileCoverPhotoStore.approvedObjectKey(PROFILE_ID, SECOND_GENERATION),
    ).toBe(secondKey);

    const response = await serve(SECOND_GENERATION);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

// The in-memory profile store mints its own ids, so this section seeds the
// rotation under the id the store actually gave the handle.
describe("moderateProfileImageAcrossStores — the two lanes agree", () => {
  let ownedProfileId = "";

  beforeEach(async () => {
    __resetProfileCoverPhotos();
    ownedProfileId = __seedMemoryOwnedProfile(HANDLE, "user-alice").id;
    await memoryProfileStore.setOwnedImage(HANDLE, "cover", {
      objectKey: profileImageServingKey("cover", ownedProfileId, FIRST_GENERATION),
      generation: FIRST_GENERATION,
      moderationState: "approved",
    });
    for (const [index, generation] of [FIRST_GENERATION, SECOND_GENERATION].entries()) {
      await memoryProfileCoverPhotoStore.create({
        id: `88888888-8888-4888-8888-88888888888${index}`,
        profileId: ownedProfileId,
        generation,
        objectKey: profileImageServingKey("cover", ownedProfileId, generation),
      });
    }
  });

  it("hides every cover in the rotation, not only the mirrored one", async () => {
    expect(await moderateProfileImageAcrossStores(HANDLE, "cover", "hide", "abusive")).toBe(
      true,
    );

    expect(await memoryProfileCoverPhotoStore.listApproved(ownedProfileId)).toEqual([]);
    expect(
      await memoryProfileCoverPhotoStore.approvedObjectKey(ownedProfileId, SECOND_GENERATION),
    ).toBeNull();
  });

  it("puts the whole rotation back on restore", async () => {
    await moderateProfileImageAcrossStores(HANDLE, "cover", "hide");
    expect(await moderateProfileImageAcrossStores(HANDLE, "cover", "restore")).toBe(true);

    expect(await memoryProfileCoverPhotoStore.listApproved(ownedProfileId)).toHaveLength(2);
  });

  it("leaves the rotation alone for the face", async () => {
    await memoryProfileStore.setOwnedImage(HANDLE, "avatar", {
      objectKey: profileImageServingKey("avatar", ownedProfileId, FIRST_GENERATION),
      generation: FIRST_GENERATION,
      moderationState: "approved",
    });
    await moderateProfileImageAcrossStores(HANDLE, "avatar", "hide");

    expect(await memoryProfileCoverPhotoStore.listApproved(ownedProfileId)).toHaveLength(2);
  });
});
