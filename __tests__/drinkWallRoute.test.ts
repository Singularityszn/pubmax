import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/venueIndex", () => ({
  resolveVenue: async (id: string) => (id === "venue-abc" ? { id, name: "The Anchor" } : null),
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const limitState = vi.hoisted(() => ({
  limited: false,
  calls: [] as Array<{ key: string; opts?: { failClosed?: boolean } }>,
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return {
    ...actual,
    isLimited: async (
      key: string,
      _durableKey: string,
      _limit?: number,
      _windowMs?: number,
      opts?: { failClosed?: boolean },
    ) => {
      limitState.calls.push({ key, opts });
      return limitState.limited;
    },
  };
});

const identityState = vi.hoisted(() => ({
  ok: true,
  accountId: "user-alice",
  profileId: "",
  handle: "alice",
}));
vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () =>
    identityState.ok
      ? {
          ok: true,
          accountId: identityState.accountId,
          actor: `profile:${identityState.profileId}`,
          handle: identityState.handle,
        }
      : {
          ok: false,
          body: { status: "sign_in_required", error: "Sign in to contribute." },
          httpStatus: 401,
        },
}));

const dobState = vi.hoisted(() => ({ dateOfBirth: "1990-05-04" as string | null }));
vi.mock("@/lib/privateIdentityStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/privateIdentityStore")>();
  return {
    ...actual,
    privateIdentityStore: () => ({
      read: async () =>
        dobState.dateOfBirth ? { dateOfBirth: dobState.dateOfBirth } : null,
    }),
  };
});

import { GET, POST } from "@/app/api/drink-wall/route";
import { __setVenuePhotoRouteDepsForTest } from "@/lib/venuePhotoRouteDeps.server";
import { __resetPintDrops } from "@/lib/pintDrops";
import {
  __resetMemoryProfiles,
  memoryProfileStore,
  profileStore,
} from "@/lib/profileStore";
import type { VenuePhotoStorage } from "@/lib/venuePhotoMedia.server";
import {
  __resetVenuePhotos,
  VENUE_PHOTO_CAP_PER_ACCOUNT,
  venuePhotoStore,
} from "@/lib/venuePhotoStore";
import { drinkWallServingKey, venuePhotoServingKey } from "@/lib/venuePhotos";
import { defined } from "@/__tests__/helpers/defined";

const VENUE = "venue-abc";

async function jpeg(): Promise<File> {
  const bytes = await sharp({
    create: { width: 900, height: 1100, channels: 3, background: "#31485f" },
  })
    .jpeg()
    .toBuffer();
  return new File([bytes], "london.jpg", { type: "image/jpeg" });
}

function memoryStorage(): VenuePhotoStorage & {
  uploads: Array<{ path: string; bytes: Buffer }>;
  keys: () => string[];
} {
  const uploads: Array<{ path: string; bytes: Buffer }> = [];
  const objects = new Map<string, Buffer>();
  return {
    uploads,
    keys: () => [...objects.keys()],
    async upload(path, bytes) {
      objects.set(path, Buffer.from(bytes));
      uploads.push({ path, bytes: Buffer.from(bytes) });
    },
    async readBack(path) {
      const bytes = objects.get(path);
      if (!bytes) return { ok: false, failure: "storage_error", detail: "Object not found" };
      return { ok: true, image: { bytes, contentType: "image/jpeg" } };
    },
    async remove(paths) {
      for (const path of paths) objects.delete(path);
    },
    async sign(path) {
      return objects.has(path) ? `https://storage.test/${path}?sig=1` : null;
    },
  };
}

function upload(file: File, post: Record<string, unknown>): Request {
  const body = new FormData();
  body.set("post", JSON.stringify(post));
  body.set("photo", file);
  return new Request("http://localhost/api/drink-wall", { method: "POST", body });
}

function deps(decision: "approved" | "needs_review" = "approved", storage = memoryStorage()) {
  __setVenuePhotoRouteDepsForTest({
    storage,
    moderation: () => ({ moderate: async () => ({ decision }) }),
    crosspost: async () => ({ state: "off" as const }),
  });
  return storage;
}

beforeEach(async () => {
  __resetVenuePhotos();
  __resetMemoryProfiles();
  __resetPintDrops();
  __setVenuePhotoRouteDepsForTest(null);
  limitState.limited = false;
  limitState.calls = [];
  dobState.dateOfBirth = "1990-05-04";
  identityState.ok = true;
  await memoryProfileStore.createOwned("alice", "user-alice");
  const profile = await profileStore().getByHandle("alice");
  identityState.profileId = profile!.id;
});

afterEach(() => {
  __setVenuePhotoRouteDepsForTest(null);
});

describe("posting a london photo to the drink wall", () => {
  it("promotes to the city serving key", async () => {
    const storage = deps("approved");
    const response = await POST(
      upload(await jpeg(), { wallCategory: "london", placeLabel: "South Bank", caption: "Skyline" }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.photo.venueId).toBe(null);
    expect(body.photo.url).toBe(`/api/drink-wall-photo/${body.photo.id}`);
    expect(storage.keys()).toEqual([drinkWallServingKey(body.photo.id)]);
  });

  it("takes a pint with no pub linked", async () => {
    const storage = deps("approved");
    const response = await POST(upload(await jpeg(), { wallCategory: "pint", drinkCategory: "beer" }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.photo.venueId).toBe(null);
    expect(storage.keys()).toEqual([drinkWallServingKey(body.photo.id)]);
  });

  it("holds a pub-linked photo to the captain's hundred for that pub", async () => {
    const storage = deps("approved");
    const store = venuePhotoStore();
    for (let i = 0; i < VENUE_PHOTO_CAP_PER_ACCOUNT; i += 1) {
      const photoId = crypto.randomUUID();
      await store.create({
        id: photoId,
        venueId: VENUE,
        wallCategory: "pint",
        placeLabel: "",
        authorActor: `profile:${identityState.profileId}`,
        authorProfileId: identityState.profileId,
        objectKey: venuePhotoServingKey(VENUE, photoId),
        drinkCategory: null,
        caption: "",
        width: 1080,
        height: 1350,
      });
    }
    const response = await POST(upload(await jpeg(), { wallCategory: "pub", venueId: VENUE }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("PHOTO_CAP_REACHED");
    expect(storage.uploads).toHaveLength(0);

    const unlinked = await POST(upload(await jpeg(), { wallCategory: "pub" }));
    expect(unlinked.status).toBe(201);
  });

  it("refuses over the drink-wall upload budget", async () => {
    limitState.limited = true;
    const storage = deps("approved");
    const response = await POST(upload(await jpeg(), { wallCategory: "london" }));
    expect(response.status).toBe(429);
    expect(storage.uploads).toHaveLength(0);
    expect(limitState.calls).toHaveLength(1);
    expect(defined(limitState.calls[0]).key).toMatch(/^venue-photo:/);
    expect(defined(limitState.calls[0]).opts?.failClosed).toBe(true);
  });
});

describe("reading the drink wall", () => {
  it("lists approved city photos", async () => {
    const store = venuePhotoStore();
    const id = crypto.randomUUID();
    await store.create({
      id,
      venueId: null,
      wallCategory: "london",
      placeLabel: "Bridge",
      authorActor: `profile:${identityState.profileId}`,
      authorProfileId: identityState.profileId,
      objectKey: drinkWallServingKey(id),
      drinkCategory: null,
      caption: "Evening",
      width: 1080,
      height: 1350,
    });
    const response = await GET(new Request("http://localhost/api/drink-wall?scope=all"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0].wallCategory).toBe("london");
    expect(body.photos[0].venueName).toBe(null);
  });

  it("names the pub a linked photo was taken at", async () => {
    const id = crypto.randomUUID();
    await venuePhotoStore().create({
      id,
      venueId: VENUE,
      wallCategory: "pub",
      placeLabel: "",
      authorActor: `profile:${identityState.profileId}`,
      authorProfileId: identityState.profileId,
      objectKey: venuePhotoServingKey(VENUE, id),
      drinkCategory: null,
      caption: "",
      width: 1080,
      height: 1350,
    });
    const body = await (await GET(new Request("http://localhost/api/drink-wall?scope=all"))).json();
    expect(body.photos[0].venueName).toBe("The Anchor");
  });
});
