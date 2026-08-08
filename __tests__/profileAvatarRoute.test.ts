import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => authState.userId };
});

const limitState = vi.hoisted(() => ({ limited: false }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return {
    ...actual,
    isLimited: async (
      _local: string,
      _durable: string,
      _limit?: number,
      _window?: number,
      opts?: { failClosed?: boolean },
    ) => {
      void opts;
      return limitState.limited;
    },
  };
});

import {
  DELETE,
  POST,
  __setProfileAvatarRouteDepsForTest,
} from "@/app/api/profiles/[handle]/avatar/route";
import { GET as getProfile } from "@/app/api/profiles/[handle]/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import {
  prepareProfileAvatar,
  purgeProfileAvatarObjects,
  type ProfileAvatarStorage,
} from "@/lib/profileAvatarMedia.server";
import {
  __resetMemoryProfiles,
  __tombstoneMemoryProfile,
  memoryProfileStore,
  profileStore,
} from "@/lib/profileStore";

async function imageFile(
  format: "jpeg" | "png" | "webp" = "jpeg",
  width = 640,
  height = 480,
): Promise<File> {
  const pipeline = sharp({
    create: { width, height, channels: 3, background: "#7d2838" },
  });
  const bytes = await pipeline[format]().toBuffer();
  return new File([bytes], `face.${format === "jpeg" ? "jpg" : format}`, {
    type: `image/${format}`,
  });
}

/** Real JPEG with an injected APP1 Exif/GPS marker (imageSafety fixture style). */
async function jpegWithFakeGps(): Promise<File> {
  const base = await sharp({
    create: { width: 96, height: 96, channels: 3, background: "#2b1d14" },
  }).jpeg().toBuffer();
  const gpsPayload = Buffer.from("Exif\0\0FAKE-GPS-LAT-51.5074-LON-0.1278", "binary");
  const app1 = Buffer.alloc(4 + gpsPayload.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(gpsPayload.length + 2, 2);
  gpsPayload.copy(app1, 4);
  const withGps = Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)]);
  expect(withGps.toString("latin1")).toContain("FAKE-GPS-LAT-51.5074-LON-0.1278");
  return new File([withGps], "geo.jpg", { type: "image/jpeg" });
}

function memoryStorage(): ProfileAvatarStorage & {
  uploads: Array<{ path: string; bytes: Buffer }>;
  removed: string[][];
} {
  const uploads: Array<{ path: string; bytes: Buffer }> = [];
  const removed: string[][] = [];
  const objects = new Map<string, Buffer>();
  return {
    uploads,
    removed,
    async upload(path, bytes) {
      objects.set(path, Buffer.from(bytes));
      uploads.push({ path, bytes: Buffer.from(bytes) });
    },
    async remove(paths) {
      removed.push([...paths]);
      for (const path of paths) objects.delete(path);
    },
    async sign(path) {
      if (!objects.has(path)) return null;
      return `https://storage.test/${path}?sig=1`;
    },
    async listAvatarKeys(profileId) {
      return [...objects.keys()].filter((key) => key.startsWith(`avatars/${profileId}/`));
    },
  };
}

async function multipart(file: File): Promise<Request> {
  const body = new FormData();
  body.set("photo", file);
  return new Request("http://localhost/api/profiles/alice/avatar", {
    method: "POST",
    body,
  });
}

beforeEach(async () => {
  authState.userId = null;
  limitState.limited = false;
  __resetMemoryProfiles();
  __resetPintDrops();
  __setProfileAvatarRouteDepsForTest(null);
  await memoryProfileStore.createOwned("alice", "user-alice");
});

afterEach(() => {
  __setProfileAvatarRouteDepsForTest(null);
});

describe("profile avatar upload route", () => {
  it("promotes an approved photo to the serving key and exposes only the served URL", async () => {
    const storage = memoryStorage();
    __setProfileAvatarRouteDepsForTest({
      storage,
      moderation: () => ({
        moderate: async () => ({ decision: "approved" }),
      }),
    });
    authState.userId = "user-alice";

    const response = await POST(await multipart(await imageFile()), {
      params: Promise.resolve({ handle: "alice" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const profile = await profileStore().getByHandle("alice");
    expect(profile?.avatarModerationState).toBe("approved");
    expect(profile?.avatarObjectKey).toBe(
      `avatars/${profile!.id}/${profile!.avatarGeneration}/image.jpg`,
    );
    expect(body.profile.avatarUrl).toBe(
      `/api/avatar/${profile!.id}/${profile!.avatarGeneration}`,
    );
    expect(storage.uploads.some((u) => u.path.endsWith("/staging.jpg"))).toBe(true);
    expect(storage.uploads.some((u) => u.path.endsWith("/image.jpg"))).toBe(true);
    // Staging removed after promote.
    expect(storage.removed.flat().some((k) => k.endsWith("/staging.jpg"))).toBe(true);
  });

  it("refuses a flagged photo, deletes staging, and leaves the profile unchanged", async () => {
    const storage = memoryStorage();
    __setProfileAvatarRouteDepsForTest({
      storage,
      moderation: () => ({
        moderate: async () => ({ decision: "needs_review" }),
      }),
    });
    authState.userId = "user-alice";

    const response = await POST(await multipart(await imageFile()), {
      params: Promise.resolve({ handle: "alice" }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/did not pass/i);
    expect(body.code).toBe("PHOTO_REFUSED");
    const profile = await profileStore().getByHandle("alice");
    expect(profile?.avatarObjectKey).toBeUndefined();
    expect(storage.uploads.every((u) => u.path.endsWith("/staging.jpg"))).toBe(true);
    expect(storage.uploads.some((u) => u.path.endsWith("/image.jpg"))).toBe(false);
    expect(storage.removed.flat().some((k) => k.endsWith("/staging.jpg"))).toBe(true);
  });

  it("refuses on moderation outage with an honest 503 and stores nothing", async () => {
    const storage = memoryStorage();
    __setProfileAvatarRouteDepsForTest({
      storage,
      moderation: () => ({
        moderate: async () => {
          throw Object.assign(new Error("offline"), { retryable: true });
        },
      }),
    });
    authState.userId = "user-alice";

    const response = await POST(await multipart(await imageFile()), {
      params: Promise.resolve({ handle: "alice" }),
    });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("We could not check this photo. Try again.");
    expect(body.code).toBe("MODERATION_UNAVAILABLE");
    const profile = await profileStore().getByHandle("alice");
    expect(profile?.avatarObjectKey).toBeUndefined();
    expect(storage.uploads.some((u) => u.path.endsWith("/image.jpg"))).toBe(false);
  });

  it("refuses when the moderation adapter cannot be constructed (no API key)", async () => {
    const storage = memoryStorage();
    const { ProfileAvatarModerationError } = await import("@/lib/profileAvatarModeration");
    __setProfileAvatarRouteDepsForTest({
      storage,
      moderation: () => {
        throw new ProfileAvatarModerationError("OpenAI moderation is not configured.", false);
      },
    });
    authState.userId = "user-alice";

    const response = await POST(await multipart(await imageFile()), {
      params: Promise.resolve({ handle: "alice" }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "We could not check this photo. Try again.",
      code: "MODERATION_UNAVAILABLE",
    });
    const profile = await profileStore().getByHandle("alice");
    expect(profile?.avatarObjectKey).toBeUndefined();
    expect(profile?.avatarModerationState).toBeUndefined();
  });

  it("strips EXIF GPS before any bytes reach storage", async () => {
    const storage = memoryStorage();
    __setProfileAvatarRouteDepsForTest({
      storage,
      moderation: () => ({
        moderate: async () => ({ decision: "approved" }),
      }),
    });
    authState.userId = "user-alice";

    const response = await POST(await multipart(await jpegWithFakeGps()), {
      params: Promise.resolve({ handle: "alice" }),
    });
    expect(response.status).toBe(200);
    expect(storage.uploads.length).toBeGreaterThan(0);
    for (const upload of storage.uploads) {
      expect(upload.bytes.toString("latin1")).not.toContain("FAKE-GPS-LAT-51.5074-LON-0.1278");
    }
    const prepared = await prepareProfileAvatar(await jpegWithFakeGps());
    expect(prepared.bytes.toString("latin1")).not.toContain("FAKE-GPS-LAT-51.5074-LON-0.1278");
    const meta = await sharp(prepared.bytes).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("requires the signed-in owner of a claimed handle", async () => {
    const storage = memoryStorage();
    __setProfileAvatarRouteDepsForTest({
      storage,
      moderation: () => ({ moderate: async () => ({ decision: "approved" }) }),
    });

    authState.userId = null;
    const anon = await POST(await multipart(await imageFile()), {
      params: Promise.resolve({ handle: "alice" }),
    });
    expect(anon.status).toBe(403);

    authState.userId = "user-other";
    const other = await POST(await multipart(await imageFile()), {
      params: Promise.resolve({ handle: "alice" }),
    });
    expect(other.status).toBe(403);
    expect(storage.uploads).toHaveLength(0);
  });

  it("rate-limits per actor with fail-closed posture", async () => {
    const storage = memoryStorage();
    __setProfileAvatarRouteDepsForTest({
      storage,
      moderation: () => ({ moderate: async () => ({ decision: "approved" }) }),
    });
    authState.userId = "user-alice";
    limitState.limited = true;

    const response = await POST(await multipart(await imageFile()), {
      params: Promise.resolve({ handle: "alice" }),
    });
    expect(response.status).toBe(429);
    expect(storage.uploads).toHaveLength(0);
  });

  it("deletes storage objects when the avatar is removed", async () => {
    const storage = memoryStorage();
    __setProfileAvatarRouteDepsForTest({
      storage,
      moderation: () => ({ moderate: async () => ({ decision: "approved" }) }),
    });
    authState.userId = "user-alice";

    const uploaded = await POST(await multipart(await imageFile()), {
      params: Promise.resolve({ handle: "alice" }),
    });
    expect(uploaded.status).toBe(200);
    const before = await profileStore().getByHandle("alice");
    expect(before?.avatarObjectKey).toBeTruthy();

    const deleted = await DELETE(
      new Request("http://localhost/api/profiles/alice/avatar", { method: "DELETE" }),
      { params: Promise.resolve({ handle: "alice" }) },
    );
    expect(deleted.status).toBe(200);
    const after = await profileStore().getByHandle("alice");
    expect(after?.avatarObjectKey).toBeUndefined();
    expect(storage.removed.flat()).toContain(before!.avatarObjectKey);
  });

  it("invokes object deletion on tombstone purge", async () => {
    const storage = memoryStorage();
    const profile = await profileStore().getByHandle("alice");
    const generation = "11111111-1111-4111-8111-111111111111";
    const objectKey = `avatars/${profile!.id}/${generation}/image.jpg`;
    await storage.upload(objectKey, Buffer.from("jpeg-bytes"), "image/jpeg");
    await memoryProfileStore.setOwnedAvatar("alice", {
      objectKey,
      generation,
      moderationState: "approved",
    });

    const removed = await purgeProfileAvatarObjects(profile!.id, storage, [objectKey]);
    expect(removed).toContain(objectKey);

    const tombstoned = __tombstoneMemoryProfile("alice");
    expect(tombstoned?.avatarObjectKey).toBeUndefined();
    expect(tombstoned?.tombstonedAt).toBeTruthy();
  });

  it("never leaks owned-avatar storage keys on the public profile read", async () => {
    const storage = memoryStorage();
    __setProfileAvatarRouteDepsForTest({
      storage,
      moderation: () => ({ moderate: async () => ({ decision: "approved" }) }),
    });
    authState.userId = "user-alice";
    await POST(await multipart(await imageFile()), {
      params: Promise.resolve({ handle: "alice" }),
    });

    authState.userId = null;
    const response = await getProfile(
      new Request("http://localhost/api/profiles/alice"),
      { params: Promise.resolve({ handle: "alice" }) },
    );
    const raw = await response.text();
    expect(raw).not.toContain("avatarObjectKey");
    expect(raw).not.toContain("avatar_object_key");
    expect(raw).not.toContain("avatarModerationState");
    expect(raw).not.toContain("staging.jpg");
    expect(raw).toContain("/api/avatar/");
  });
});

describe("0089 profile avatar migration shape", () => {
  it("pins the serving key and extends the tombstone path to delete storage", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260808170000_0089_profile_avatars.sql"),
      "utf8",
    );
    expect(sql).toMatch(/profiles_avatar_object_key_check/);
    expect(sql).toMatch(/avatars\/' \|\| id::text \|\| '\/' \|\| avatar_generation::text \|\| '\/image\.jpg'/);
    expect(sql).toMatch(/delete from storage\.objects/i);
    expect(sql).toMatch(/avatar_object_key = null/);
    expect(sql).toMatch(/stamp_profile_tombstone_on_auth_user_delete/);
  });
});
