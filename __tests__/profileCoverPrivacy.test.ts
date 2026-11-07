import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const api = vi.hoisted(() => ({
  client: null as SupabaseClient | null,
  edges: new Set<string>(),
  authUnavailable: false,
  profileUnavailable: false,
  followUnavailable: false,
  withdrawn: false,
  paths: [] as string[],
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    getSupabaseAdmin: () => api.client,
    requireSupabaseAdmin: () => {
      if (!api.client) throw new Error("Test API was not initialized.");
      return api.client;
    },
    clientIp: () => "127.0.0.1",
    hashIp: () => "profile-cover-test",
  };
});
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { GET } from "@/app/api/cover/[profileId]/[generation]/route";
import { GET as GET_AVATAR } from "@/app/api/avatar/[profileId]/[generation]/route";
import { __resetMemoryProfileWithdrawals } from "@/lib/accountPublicAccess.server";
import {
  __setAvatarServeRouteDepsForTest,
  __setCoverServeRouteDepsForTest,
} from "@/lib/profileImageServeRouteDeps.server";
import { profileImageServingKey } from "@/lib/profileImageSlots";
import type { ProfileRecord } from "@/lib/profileStore";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const ROTATION_GENERATION = "33333333-3333-4333-8333-333333333333";
const MATE_PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const COVER_BYTES = Buffer.from("private-cover-fixture");

const profile: ProfileRecord = {
  id: PROFILE_ID,
  handle: "alice",
  userId: "owner-user",
  visibility: "private",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  coverObjectKey: profileImageServingKey("cover", PROFILE_ID, GENERATION),
  coverGeneration: GENERATION,
  coverModerationState: "approved",
  avatarObjectKey: profileImageServingKey("avatar", PROFILE_ID, GENERATION),
  avatarGeneration: GENERATION,
  avatarModerationState: "approved",
};
let currentProfile: ProfileRecord;
const downloadObject = vi.fn(async () => ({ bytes: COVER_BYTES, contentType: "image/jpeg" as const }));

// Only the external Auth and PostgREST responses are fixtures. The route,
// bearer verification, profile store and mutual-follow policy remain real.
const fixtureFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  api.paths.push(url.pathname);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  if (url.pathname === "/auth/v1/user") {
    if (api.authUnavailable) return json({ code: "unexpected_failure", msg: "Auth unavailable" }, 400);
    const token = new Headers(init?.headers).get("Authorization")?.replace("Bearer ", "");
    if (token === "owner-token") return json({ id: "owner-user" });
    if (token === "mate-token") return json({ id: "mate-user" });
    if (token === "stranger-token") return json({ id: "stranger-user" });
    if (token === "no-handle-token") return json({ id: "no-handle-user" });
    if (token === "banned-token") return json({ id: "owner-user", banned_until: "2999-01-01T00:00:00Z" });
    return json({ code: "bad_jwt", msg: "Invalid token" }, 401);
  }
  if (url.pathname === "/rest/v1/rpc/public_withdrawn_profiles") {
    return json(api.withdrawn ? [{ profile_id: PROFILE_ID, handle: "alice" }] : []);
  }
  if (url.pathname === "/rest/v1/profiles") {
    if (api.profileUnavailable) return json({ message: "Profile read unavailable" }, 400);
    const rows = [
      { id: PROFILE_ID, handle: "alice", user_id: "owner-user" },
      { id: MATE_PROFILE_ID, handle: "mate", user_id: "mate-user" },
      { id: "55555555-5555-4555-8555-555555555555", handle: "stranger", user_id: "stranger-user" },
    ];
    return json(rows.filter((row) => Object.entries(row).every(([field, value]) => {
      const filter = url.searchParams.get(field);
      return !filter || filter === `eq.${value}`;
    })));
  }
  if (url.pathname === "/rest/v1/follows") {
    if (api.followUnavailable) return json({ message: "Follow read unavailable" }, 400);
    const from = url.searchParams.get("follower_id")?.slice(3);
    const to = url.searchParams.get("followee_id")?.slice(3);
    return json(api.edges.has(`${from}>${to}`) ? [{ id: "follow" }] : []);
  }
  if (url.pathname === "/rest/v1/profile_cover_photos") {
    return json({
      object_key: profileImageServingKey("cover", PROFILE_ID, ROTATION_GENERATION),
      moderation_state: "approved",
    });
  }
  throw new Error(`Unexpected external request: ${url.pathname}`);
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  api.edges.clear();
  api.paths.length = 0;
  api.authUnavailable = false;
  api.profileUnavailable = false;
  api.followUnavailable = false;
  api.withdrawn = false;
  currentProfile = { ...profile };
  downloadObject.mockClear();
  api.client = createClient("https://profile-cover.test", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fixtureFetch },
  });
  __resetMemoryProfileWithdrawals();
  __setCoverServeRouteDepsForTest({
    getProfileById: async () => currentProfile,
    downloadObject,
  });
});

function serve(token?: string, generation = GENERATION, query = ""): Promise<Response> {
  return GET(
    new Request(`https://example.test/api/cover/${PROFILE_ID}/${generation}${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
    { params: Promise.resolve({ profileId: PROFILE_ID, generation }) },
  );
}

function makeMates(): void {
  api.edges.add(`${PROFILE_ID}>${MATE_PROFILE_ID}`);
  api.edges.add(`${MATE_PROFILE_ID}>${PROFILE_ID}`);
}

afterEach(() => {
  __setCoverServeRouteDepsForTest(null);
  __setAvatarServeRouteDepsForTest(null);
  __resetMemoryProfileWithdrawals();
  vi.restoreAllMocks();
});

it("refuses a retained private cover URL when the reader is anonymous", async () => {
  const response = await GET(
    new Request(`https://example.test/api/cover/${PROFILE_ID}/${GENERATION}`),
    { params: Promise.resolve({ profileId: PROFILE_ID, generation: GENERATION }) },
  );

  expect(response.status).toBe(404);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.text()).not.toContain(COVER_BYTES.toString());
});

it("serves a public cover without shared caching because its visibility can change", async () => {
  __setCoverServeRouteDepsForTest({
    getProfileById: async () => ({ ...profile, visibility: "public" }),
    downloadObject: async () => ({ bytes: COVER_BYTES, contentType: "image/jpeg" as const }),
  });
  const response = await GET(
    new Request(`https://example.test/api/cover/${PROFILE_ID}/${GENERATION}`),
    { params: Promise.resolve({ profileId: PROFILE_ID, generation: GENERATION }) },
  );

  expect(response.status).toBe(200);
  expect(await response.text()).toBe(COVER_BYTES.toString());
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

it.each(["owner-token", "mate-token"])("serves a private cover to the verified %s", async (token) => {
  makeMates();
  const response = await serve(token);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(COVER_BYTES.toString());
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

it.each([undefined, "stranger-token", "invalid-token", "no-handle-token", "banned-token"])(
  "refuses every private cover generation for %s before storage or rotation",
  async (token) => {
    for (const generation of [GENERATION, ROTATION_GENERATION]) {
      const response = await serve(token, generation, "?viewer=alice");
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(COVER_BYTES.toString());
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(downloadObject).not.toHaveBeenCalled();
    expect(api.paths).not.toContain("/rest/v1/profile_cover_photos");
  },
);

it.each([`${PROFILE_ID}>${MATE_PROFILE_ID}`, `${MATE_PROFILE_ID}>${PROFILE_ID}`])(
  "does not treat the one-way edge %s as a mate",
  async (edge) => {
    api.edges.add(edge);
    expect((await serve("mate-token")).status).toBe(404);
    expect(downloadObject).not.toHaveBeenCalled();
  },
);

it.each(["authUnavailable", "profileUnavailable", "followUnavailable"] as const)(
  "refuses private cover bytes when %s",
  async (failure) => {
    makeMates();
    api[failure] = true;
    expect((await serve("mate-token", ROTATION_GENERATION)).status).toBe(404);
    expect(downloadObject).not.toHaveBeenCalled();
    expect(api.paths).not.toContain("/rest/v1/profile_cover_photos");
  },
);

it.each(["owner-token", "mate-token"])("serves an approved rotation generation to %s", async (token) => {
  makeMates();
  const response = await serve(token, ROTATION_GENERATION);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(COVER_BYTES.toString());
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

it("refuses a retained URL after the mutual relationship ends", async () => {
  makeMates();
  expect((await serve("mate-token")).status).toBe(200);
  api.edges.delete(`${PROFILE_ID}>${MATE_PROFILE_ID}`);
  const response = await serve("mate-token");
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain(COVER_BYTES.toString());
  expect(downloadObject).toHaveBeenCalledTimes(1);
});

it("refuses the same URL when a public profile becomes private", async () => {
  currentProfile.visibility = "public";
  const publicResponse = await serve();
  expect(publicResponse.status).toBe(200);
  expect(publicResponse.headers.get("Cache-Control")).toBe("private, no-store");
  currentProfile.visibility = "private";
  expect((await serve()).status).toBe(404);
  expect(downloadObject).toHaveBeenCalledTimes(1);
});

it.each(["pending", "needs_review", "hidden"] as const)(
  "keeps the profile-level %s decision terminal for all cover generations",
  async (moderationState) => {
    currentProfile.coverModerationState = moderationState;
    for (const generation of [GENERATION, ROTATION_GENERATION]) {
      expect((await serve("owner-token", generation)).status).toBe(404);
    }
    expect(downloadObject).not.toHaveBeenCalled();
    expect(api.paths).not.toContain("/rest/v1/profile_cover_photos");
  },
);

it("keeps public withdrawal terminal even for the owner and rotation", async () => {
  api.withdrawn = true;
  expect((await serve("owner-token", ROTATION_GENERATION)).status).toBe(404);
  expect(downloadObject).not.toHaveBeenCalled();
  expect(api.paths).not.toContain("/rest/v1/profile_cover_photos");
});

it.each([
  { userId: undefined },
  { tombstonedAt: "2026-10-04T12:00:00.000Z" },
])("refuses unclaimed or tombstoned cover bytes: %j", async (overrides) => {
  currentProfile = { ...currentProfile, visibility: "public", ...overrides };
  expect((await serve(undefined, ROTATION_GENERATION)).status).toBe(404);
  expect(downloadObject).not.toHaveBeenCalled();
  expect(api.paths).not.toContain("/rest/v1/profile_cover_photos");
});

it("keeps the avatar of a private profile public without verifying viewer identity", async () => {
  api.authUnavailable = true;
  __setAvatarServeRouteDepsForTest({ getProfileById: async () => currentProfile, downloadObject });
  const response = await GET_AVATAR(
    new Request(`https://example.test/api/avatar/${PROFILE_ID}/${GENERATION}`),
    { params: Promise.resolve({ profileId: PROFILE_ID, generation: GENERATION }) },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=3600");
  expect(api.paths).not.toContain("/auth/v1/user");
});
