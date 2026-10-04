import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// A moderator reviewing a reported cover on a PRIVATE profile must see the
// photo they are deciding on. The admin console renders the queue's
// `previewUrl` as a plain image, so the request carries the admin session
// cookie and no reader bearer. The ordinary cover route stays owner/mate only;
// the preview lane is open to a moderator, and only for a generation that is
// in the reported-cover queue right now.

const api = vi.hoisted(() => ({
  client: null as SupabaseClient | null,
  profiles: [] as Record<string, unknown>[],
  covers: [] as Record<string, unknown>[],
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
    hashIp: () => "moderator-preview-test",
  };
});
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { GET as QUEUE } from "@/app/api/admin/profile-avatars/route";
import { GET as PREVIEW } from "@/app/api/admin/profile-avatars/cover/[profileId]/[generation]/route";
import { GET as COVER } from "@/app/api/cover/[profileId]/[generation]/route";
import { ADMIN_SESSION_COOKIE, hashAdminSession } from "@/lib/adminAuth";
import { __setCoverServeRouteDepsForTest } from "@/lib/profileImageServeRouteDeps.server";
import { profileImageServingKey } from "@/lib/profileImageSlots";

const ADMIN_TOKEN = "moderator-secret";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const MIRROR_GENERATION = "22222222-2222-4222-8222-222222222222";
const ROTATION_GENERATION = "33333333-3333-4333-8333-333333333333";
const UNREPORTED_GENERATION = "44444444-4444-4444-8444-444444444444";
const COVER_BYTES = Buffer.from("private-cover-under-review");
const downloadObject = vi.fn(async () => ({ bytes: COVER_BYTES, contentType: "image/jpeg" as const }));

function cookie(token = ADMIN_TOKEN): HeadersInit {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(hashAdminSession(token))}` };
}

function matches(row: Record<string, unknown>, url: URL): boolean {
  for (const [field, filter] of url.searchParams) {
    if (["select", "order", "limit", "offset", "not"].includes(field)) continue;
    const value = row[field];
    if (filter.startsWith("eq.") && String(value) !== filter.slice(3)) return false;
    if (filter.startsWith("gt.") && !(Number(value ?? 0) > Number(filter.slice(3)))) return false;
    if (filter === "is.null" && value != null) return false;
  }
  return true;
}

const fixtureFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const json = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  const pick = (rows: Record<string, unknown>[]) => {
    const found = rows.filter((row) => matches(row, url));
    const single = new Headers(init?.headers).get("Accept")?.includes("vnd.pgrst.object");
    return json(single ? found[0] ?? null : found);
  };
  if (url.pathname === "/rest/v1/rpc/public_withdrawn_profiles") return json([]);
  if (url.pathname === "/rest/v1/profiles") return pick(api.profiles);
  if (url.pathname === "/rest/v1/profile_cover_photos") return pick(api.covers);
  if (url.pathname === "/auth/v1/user") return json({ id: "stranger-user" });
  throw new Error(`Unexpected external request: ${url.pathname}`);
};

function coverRow(generation: string, position: number, reported: boolean): Record<string, unknown> {
  return {
    id: `cover-${position}`,
    profile_id: PROFILE_ID,
    position,
    generation,
    object_key: profileImageServingKey("cover", PROFILE_ID, generation),
    moderation_state: "approved",
    report_count: reported ? 1 : 0,
    reported_at: reported ? "2026-10-04T10:00:00.000Z" : null,
    moderated_at: null,
    created_at: "2026-10-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("ADMIN_TOKEN", ADMIN_TOKEN);
  downloadObject.mockClear();
  api.profiles = [{
    id: PROFILE_ID,
    handle: "alice",
    user_id: "owner-user",
    visibility: "private",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    cover_object_key: profileImageServingKey("cover", PROFILE_ID, MIRROR_GENERATION),
    cover_generation: MIRROR_GENERATION,
    cover_moderation_state: "approved",
    cover_report_count: 1,
    cover_reported_at: "2026-10-04T09:00:00.000Z",
    cover_report_reason: "not a pub",
    cover_moderated_at: null,
  }];
  api.covers = [
    coverRow(MIRROR_GENERATION, 1, false),
    coverRow(ROTATION_GENERATION, 2, true),
    coverRow(UNREPORTED_GENERATION, 3, false),
  ];
  api.client = createClient("https://moderator-preview.test", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fixtureFetch },
  });
  __setCoverServeRouteDepsForTest({ downloadObject });
});

afterEach(() => {
  __setCoverServeRouteDepsForTest(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function preview(generation: string, headers: HeadersInit = cookie()): Promise<Response> {
  return PREVIEW(
    new Request(`http://localhost/api/admin/profile-avatars/cover/${PROFILE_ID}/${generation}`, { headers }),
    { params: Promise.resolve({ profileId: PROFILE_ID, generation }) },
  );
}

async function openPreviewUrl(previewUrl: string): Promise<Response> {
  const [profileId, generation] = previewUrl.split("/").slice(-2) as [string, string];
  const request = new Request(`http://localhost${previewUrl}`, { headers: cookie() });
  const context = { params: Promise.resolve({ profileId, generation }) };
  return previewUrl.startsWith("/api/cover/") ? COVER(request, context) : PREVIEW(request, context);
}

it("shows the moderator every reported private cover the queue lists", async () => {
  const response = await QUEUE(new Request(
    "http://localhost/api/admin/profile-avatars?status=reported&slot=cover",
    { headers: cookie() },
  ));
  expect(response.status).toBe(200);
  const body = await response.json() as {
    avatars: { previewUrl?: string }[];
    rotationCovers: { previewUrl?: string }[];
  };
  const previewUrls = [...body.avatars, ...body.rotationCovers].map((row) => row.previewUrl);
  expect(previewUrls).toHaveLength(2);
  for (const previewUrl of previewUrls) {
    expect(previewUrl).toBeTruthy();
    const image = await openPreviewUrl(previewUrl!);
    expect(image.status).toBe(200);
    expect(await image.text()).toBe(COVER_BYTES.toString());
    expect(image.headers.get("Cache-Control")).toBe("private, no-store");
  }
});

it("keeps the ordinary private cover route closed to a moderator session", async () => {
  const response = await COVER(
    new Request(`http://localhost/api/cover/${PROFILE_ID}/${MIRROR_GENERATION}`, { headers: cookie() }),
    { params: Promise.resolve({ profileId: PROFILE_ID, generation: MIRROR_GENERATION }) },
  );
  expect(response.status).toBe(404);
  expect(downloadObject).not.toHaveBeenCalled();
});

it.each([
  ["no session", {}],
  ["a tampered session", { cookie: `${ADMIN_SESSION_COOKIE}=tampered` }],
  ["a session from a rotated token", cookie("previous-secret")],
  ["a reader bearer", { Authorization: "Bearer stranger-token" }],
])("refuses the preview with %s", async (_label, headers) => {
  const response = await preview(ROTATION_GENERATION, headers);
  expect(response.status).toBe(403);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.text()).not.toContain(COVER_BYTES.toString());
  expect(downloadObject).not.toHaveBeenCalled();
});

it("refuses a moderator preview of a cover nobody reported", async () => {
  const response = await preview(UNREPORTED_GENERATION);
  expect(response.status).toBe(404);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(downloadObject).not.toHaveBeenCalled();
});

it("refuses a generation that is not on the profile", async () => {
  const response = await preview("55555555-5555-4555-8555-555555555555");
  expect(response.status).toBe(404);
  expect(downloadObject).not.toHaveBeenCalled();
});

it("closes the preview once the report has been decided", async () => {
  expect((await preview(ROTATION_GENERATION)).status).toBe(200);
  expect((await preview(MIRROR_GENERATION)).status).toBe(200);
  api.covers[1]!.moderated_at = "2026-10-04T11:00:00.000Z";
  api.profiles[0]!.cover_moderated_at = "2026-10-04T11:00:00.000Z";
  expect((await preview(ROTATION_GENERATION)).status).toBe(404);
  expect((await preview(MIRROR_GENERATION)).status).toBe(404);
  expect(downloadObject).toHaveBeenCalledTimes(2);
});

it("refuses a reported cover a moderator has already hidden", async () => {
  api.covers[1]!.moderation_state = "hidden";
  expect((await preview(ROTATION_GENERATION)).status).toBe(404);
  expect(downloadObject).not.toHaveBeenCalled();
});
