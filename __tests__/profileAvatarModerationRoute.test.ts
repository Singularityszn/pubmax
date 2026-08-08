import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The complaint side of the owned-avatar path: a reader can FLAG a face, a
// moderator can HIDE it, and a hidden face leaves every public read at once
// (publicOwnedAvatarUrl becomes undefined so initials win). Hide never deletes
// storage or report provenance, and restore puts the approved face back.
//
// Two seams are mocked so this is deterministic under a PRODUCTION build too
// (same shape as communityPriceModeration.test.ts / adminCommentsRoute.test.ts):
//   • @/lib/supabase isSupabaseConfigured() === false pins the in-memory store.
//   • @/lib/adminAuth isModerator() - the REAL gate opens on a NODE_ENV read
//     when ADMIN_TOKEN is unset, which a prod build would deny. Only that
//     branch is replaced, by a controllable flag; the token compare is kept so
//     the "wrong token → 403" case still exercises real auth.

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const { devGate } = vi.hoisted(() => ({ devGate: { open: true } }));
vi.mock("@/lib/adminAuth", () => ({
  isModerator: (request: Request): boolean => {
    const expected = process.env.ADMIN_TOKEN;
    const provided = request.headers.get("x-admin-token") ?? undefined;
    if (!expected) return devGate.open;
    if (!provided) return false;
    return provided === expected;
  },
}));

import { GET as adminGET, POST as adminPOST } from "@/app/api/admin/profile-avatars/route";
import { POST as reportPOST } from "@/app/api/profiles/[handle]/avatar/report/route";
import {
  __resetMemoryProfiles,
  listHiddenProfileAvatars,
  listReportedProfileAvatars,
  moderateProfileAvatar,
  profileStore,
  publicOwnedAvatarUrl,
  reportProfileAvatar,
} from "@/lib/profileStore";

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const ADMIN_URL = "http://localhost/api/admin/profile-avatars";

function adminPost(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return adminPOST(
    new Request(ADMIN_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers ?? {}) },
      body: JSON.stringify(body),
    }),
  );
}

async function seedApprovedAvatar(handle: string, generation = "11111111-1111-4111-8111-111111111111") {
  const store = profileStore();
  await store.createOwned(handle, `user-${handle}`);
  const profile = await store.getByHandle(handle);
  expect(profile?.id).toBeTruthy();
  const objectKey = `avatars/${profile!.id}/${generation}/image.jpg`;
  const updated = await store.setOwnedAvatar(handle, {
    objectKey,
    generation,
    moderationState: "approved",
  });
  expect(updated?.avatarModerationState).toBe("approved");
  expect(publicOwnedAvatarUrl(updated!)).toBe(`/api/avatar/${profile!.id}/${generation}`);
  return updated!;
}

describe("profile avatar moderation (memory backend)", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.ADMIN_TOKEN;
    devGate.open = true;
  });

  afterEach(() => {
    __resetMemoryProfiles();
    if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
    if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  afterAll(() => {
    if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  });

  it("hides an avatar from the public serve URL, and restores it", async () => {
    const profile = await seedApprovedAvatar("alice");
    expect(publicOwnedAvatarUrl(profile)).toBeTruthy();

    expect(await moderateProfileAvatar("alice", "hide", "not their face")).toBe(true);
    const hidden = await profileStore().getByHandle("alice");
    expect(hidden?.avatarModerationState).toBe("hidden");
    expect(publicOwnedAvatarUrl(hidden!)).toBeUndefined();
    // Hide, never delete: object key and generation survive for provenance.
    expect(hidden?.avatarObjectKey).toBe(profile.avatarObjectKey);
    expect(hidden?.avatarGeneration).toBe(profile.avatarGeneration);

    expect(await moderateProfileAvatar("alice", "restore")).toBe(true);
    const restored = await profileStore().getByHandle("alice");
    expect(restored?.avatarModerationState).toBe("approved");
    expect(publicOwnedAvatarUrl(restored!)).toBe(
      `/api/avatar/${profile.id}/${profile.avatarGeneration}`,
    );
  });

  it("records a report without hiding anything", async () => {
    const profile = await seedApprovedAvatar("bob");
    expect(await reportProfileAvatar("bob", "spam QR", "actor-1")).toBe(true);

    const after = await profileStore().getByHandle("bob");
    expect(after?.avatarModerationState).toBe("approved");
    expect(publicOwnedAvatarUrl(after!)).toBe(
      `/api/avatar/${profile.id}/${profile.avatarGeneration}`,
    );

    const queue = await listReportedProfileAvatars();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      handle: "bob",
      reportCount: 1,
      reportReason: "spam QR",
      moderationState: "approved",
    });
    expect(JSON.stringify(queue)).not.toContain("actor-1");
  });

  it("counts one report per actor, so a single reader cannot inflate the queue", async () => {
    await seedApprovedAvatar("cara");
    await reportProfileAvatar("cara", "wrong", "actor-1");
    await reportProfileAvatar("cara", "still wrong", "actor-1");
    expect((await listReportedProfileAvatars())[0]?.reportCount).toBe(1);

    await reportProfileAvatar("cara", "agreed", "actor-2");
    expect((await listReportedProfileAvatars())[0]?.reportCount).toBe(2);
  });

  it("never exposes reporter actors in the moderator DTO", async () => {
    await seedApprovedAvatar("dave");
    await reportProfileAvatar("dave", "wrong", "secret-reporter-token");
    expect(JSON.stringify(await listReportedProfileAvatars())).not.toContain(
      "secret-reporter-token",
    );
    expect(JSON.stringify(await listHiddenProfileAvatars())).not.toContain(
      "secret-reporter-token",
    );
  });

  it("returns unreported, visible avatars to nobody's queue", async () => {
    await seedApprovedAvatar("elsie");
    expect(await listReportedProfileAvatars()).toEqual([]);
    expect(await listHiddenProfileAvatars()).toEqual([]);
  });

  it("moves a hidden avatar into the hidden lane and keeps restore reversible", async () => {
    await seedApprovedAvatar("frank");
    await reportProfileAvatar("frank", "abuse", "actor-1");
    expect(await listReportedProfileAvatars()).toHaveLength(1);

    expect(await moderateProfileAvatar("frank", "hide")).toBe(true);
    expect(await listReportedProfileAvatars()).toEqual([]);
    expect(await listHiddenProfileAvatars()).toHaveLength(1);
    expect((await listHiddenProfileAvatars())[0]?.handle).toBe("frank");

    expect(await moderateProfileAvatar("frank", "restore")).toBe(true);
    expect(await listHiddenProfileAvatars()).toEqual([]);
    // Restore stamps moderatedAt, so the old reports leave the reported lane
    // until a new distinct reporter re-opens them.
    expect(await listReportedProfileAvatars()).toEqual([]);
  });

  describe("POST /api/profiles/[handle]/avatar/report", () => {
    it("queues a flag and never auto-hides", async () => {
      const profile = await seedApprovedAvatar("gina");
      const res = await reportPOST(
        new Request("http://localhost/api/profiles/gina/avatar/report", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
          body: JSON.stringify({ reason: "somebody else" }),
        }),
        { params: Promise.resolve({ handle: "gina" }) },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toEqual({ ok: true });

      const after = await profileStore().getByHandle("gina");
      expect(after?.avatarModerationState).toBe("approved");
      expect(publicOwnedAvatarUrl(after!)).toBe(
        `/api/avatar/${profile.id}/${profile.avatarGeneration}`,
      );
      expect(await listReportedProfileAvatars()).toHaveLength(1);
    });

    it("404s when there is no approved owned avatar to report", async () => {
      await profileStore().createOwned("ghost", "user-ghost");
      const res = await reportPOST(
        new Request("http://localhost/api/profiles/ghost/avatar/report", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
        { params: Promise.resolve({ handle: "ghost" }) },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/admin/profile-avatars", () => {
    it("hides an avatar for a moderator and 404s an unknown handle", async () => {
      await seedApprovedAvatar("helen");

      const res = await adminPost({ action: "hide", handle: "helen", note: "impersonation" });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(publicOwnedAvatarUrl((await profileStore().getByHandle("helen"))!)).toBeUndefined();

      expect((await adminPost({ action: "hide", handle: "nope" })).status).toBe(404);
    });

    it("restores a hidden avatar", async () => {
      await seedApprovedAvatar("ivan");
      await adminPost({ action: "hide", handle: "ivan" });
      expect((await adminPost({ action: "restore", handle: "ivan" })).status).toBe(200);
      expect(publicOwnedAvatarUrl((await profileStore().getByHandle("ivan"))!)).toBeTruthy();
    });

    it("rejects an unknown action and a missing handle", async () => {
      await seedApprovedAvatar("jane");
      expect((await adminPost({ action: "delete", handle: "jane" })).status).toBe(400);
      expect((await adminPost({ action: "hide" })).status).toBe(400);
    });

    it("refuses a non-moderator", async () => {
      await seedApprovedAvatar("kate");
      process.env.ADMIN_TOKEN = "s3cret";

      expect((await adminPost({ action: "hide", handle: "kate" })).status).toBe(403);
      expect(
        (await adminPost({ action: "hide", handle: "kate" }, { "x-admin-token": "wrong" })).status,
      ).toBe(403);
      expect((await adminGET(new Request(`${ADMIN_URL}?status=reported`))).status).toBe(403);

      expect(publicOwnedAvatarUrl((await profileStore().getByHandle("kate"))!)).toBeTruthy();

      const allowed = await adminPost(
        { action: "hide", handle: "kate" },
        { "x-admin-token": "s3cret" },
      );
      expect(allowed.status).toBe(200);
    });

    it("lists reported and hidden lanes for a moderator", async () => {
      await seedApprovedAvatar("leo");
      await reportProfileAvatar("leo", "wrong", "actor-1");

      const reported = await adminGET(new Request(`${ADMIN_URL}?status=reported`));
      expect(reported.status).toBe(200);
      const reportedBody = (await reported.json()) as {
        avatars: Array<{ handle: string; reportCount: number }>;
      };
      expect(reportedBody.avatars.map((row) => row.handle)).toEqual(["leo"]);
      expect(reportedBody.avatars[0]?.reportCount).toBe(1);

      await adminPost({ action: "hide", handle: "leo" });
      const hidden = await adminGET(new Request(`${ADMIN_URL}?status=hidden`));
      expect(hidden.status).toBe(200);
      const hiddenBody = (await hidden.json()) as { avatars: Array<{ handle: string }> };
      expect(hiddenBody.avatars.map((row) => row.handle)).toEqual(["leo"]);
    });
  });
});
