import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { GET } from "@/app/api/social/media/[mediaId]/route";
import { GET as adminGET } from "@/app/api/admin/social-posts/media/[mediaId]/route";
import { POST as createModeratorSession } from "@/app/api/admin/session/route";
import { POST as createSocialPost } from "@/app/api/social/posts/route";
import {
  AUTH_READ_COOKIE,
  mintAuthReadCredential,
} from "@/lib/authReadCredential.server";
import { AUTH_RESUME_COOKIE, encodeAuthResumeCookie } from "@/lib/authSessionResume";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { createResumePersistence } from "@/lib/authResumePersistence";

const MEDIA_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT_ID = "44444444-4444-4444-8444-444444444444";
const STAFF_ID = "55555555-5555-4555-8555-555555555555";
const OBJECT_KEY = `social/${MEDIA_ID}/66666666-6666-4666-8666-666666666666/image.jpg`;
const JPEG = new Uint8Array([255, 216, 255, 224, 1, 2, 3, 255, 217]);
const state = {
  authorized: true, staffActive: true, limited: false,
  imageState: "valid" as "valid" | "missing" | "corrupt", paths: [] as string[],
  // The signed-out door: the rows holding this photo, the author's account
  // choice, and the reader the media read is asked for (null is nobody).
  lanePosts: [] as Array<Record<string, unknown>>,
  authorVisibility: "public" as string | null,
  mediaViewer: PROFILE_ID as string | null,
};

function londonLaneRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    author_profile_id: PROFILE_ID,
    author_handle: "alice",
    kind: "standard",
    visibility: "public",
    status: "visible",
    body: "Proper pint at the Lamb",
    area_slug: "camden",
    venue_id: null,
    hashtags: [],
    comment_policy: "open",
    photo_media_id: MEDIA_ID,
    photo_alt_text: "A pint on the bar",
    author_name_hidden: false,
    moderation_state: "approved",
    revision: 0,
    mutation_version: 0,
    created_at: "2026-11-01T19:00:00.000Z",
    updated_at: "2026-11-01T19:00:00.000Z",
    ...overrides,
  };
}

// GoTrue's refresh-token rules (supabase.com/docs/guides/auth/sessions): a
// token spends once. A spent token gets the active token back when it is the
// active token's parent or still inside the 10 second reuse interval, and
// nothing new is minted. Any other reuse revokes the whole session.
const GOTRUE_REUSE_INTERVAL_MS = 10_000;
const gotrue = {
  tokens: new Map<string, { parent: string | null; spentAt: number | null }>(),
  active: "",
  revoked: false,
};

function gotrueSession(): string {
  gotrue.tokens = new Map([["gotrue-0", { parent: null, spentAt: null }]]);
  gotrue.active = "gotrue-0";
  gotrue.revoked = false;
  return gotrue.active;
}

function gotrueRefresh(token: string): { ok: true; token: string } | { ok: false } {
  const presented = gotrue.tokens.get(token);
  if (!presented || gotrue.revoked) return { ok: false };
  if (presented.spentAt === null) {
    const child = `gotrue-${gotrue.tokens.size}`;
    gotrue.tokens.set(child, { parent: token, spentAt: null });
    presented.spentAt = Date.now();
    gotrue.active = child;
    return { ok: true, token: child };
  }
  if (
    gotrue.tokens.get(gotrue.active)?.parent === token ||
    Date.now() - presented.spentAt <= GOTRUE_REUSE_INTERVAL_MS
  ) {
    return { ok: true, token: gotrue.active };
  }
  gotrue.revoked = true;
  return { ok: false };
}

// Only the external Auth, PostgREST and Storage responses are fixtures. The
// GET handlers, identity checks, stores, limiter and image reader remain real.
const fixtureFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "social-media.test") throw new Error("Unexpected fixture host.");
  state.paths.push(url.pathname);
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  if (url.pathname === "/auth/v1/user") {
    const bearer = new Headers(init?.headers).get("authorization");
    return bearer === "Bearer fixture-user-token"
      ? json({ id: USER_ID }) : json({ code: "bad_jwt", msg: "Invalid token" }, 401);
  }
  if (url.pathname === "/auth/v1/token") {
    const body = JSON.parse(String(init?.body)) as { refresh_token?: string };
    if (body.refresh_token?.startsWith("gotrue-")) {
      const refreshed = gotrueRefresh(body.refresh_token);
      return refreshed.ok
        ? json({ access_token: "fixture-access-token", refresh_token: refreshed.token, user: { id: USER_ID, email: "alice@example.test" } })
        : json({ error_code: "refresh_token_already_used" }, 400);
    }
    return json({ error: "invalid_grant" }, 400);
  }
  if (url.pathname === "/rest/v1/rpc/provision_social_product_account") {
    return json([{ ok: true, product_account_id: ACCOUNT_ID, provisioned: false }]);
  }
  if (url.pathname === "/rest/v1/private_social_accounts") {
    return json([{ id: ACCOUNT_ID, clerk_user_id: "fixture-account", profile_id: PROFILE_ID, ownership_state: "active" }]);
  }
  if (url.pathname === "/rest/v1/profiles") {
    return json([{ id: PROFILE_ID, handle: "alice", user_id: USER_ID, visibility: state.authorVisibility }]);
  }
  if (url.pathname === "/rest/v1/private_account_identities") return json([{ date_of_birth: "1990-01-01" }]);
  if (url.pathname === "/rest/v1/adult_self_assertions") return json([]);
  if (url.pathname === "/rest/v1/rpc/check_rate_limit") return json(state.limited);
  if (url.pathname === "/rest/v1/social_posts") return json(state.lanePosts);
  if (url.pathname === "/rest/v1/rpc/public_withdrawn_profiles") return json([]);
  if (url.pathname === "/rest/v1/rpc/read_social_post_media") {
    const body = JSON.parse(String(init?.body)) as { p_viewer: string | null; p_media_id: string };
    expect(body).toEqual({ p_viewer: state.mediaViewer, p_media_id: MEDIA_ID });
    return json(state.authorized ? [{ object_key: OBJECT_KEY }] : []);
  }
  if (url.pathname === "/rest/v1/rpc/read_social_post_media_admin") {
    const body = JSON.parse(String(init?.body)) as { p_staff_role_id: string; p_media_id: string };
    expect(body).toEqual({ p_staff_role_id: STAFF_ID, p_media_id: MEDIA_ID });
    return state.staffActive ? json([{ object_key: OBJECT_KEY }]) : json({ message: "staff required" }, 400);
  }
  if (url.pathname.startsWith("/storage/v1/object/sign/")) {
    return json({ signedURL: `/object/sign/pint-drops/${OBJECT_KEY}?token=fixture-signed-token` });
  }
  if (url.pathname === `/storage/v1/object/pint-drops/${OBJECT_KEY}`) {
    if (state.imageState === "missing") return json({ message: "Object unavailable" }, 404);
    return new Response(state.imageState === "corrupt" ? new Uint8Array([1, 2, 3]) : JPEG, {
      headers: { "content-type": "image/jpeg" },
    });
  }
  throw new Error(`Unexpected fixture path: ${url.pathname}`);
};

beforeEach(() => {
  state.authorized = true;
  state.staffActive = true;
  state.limited = false;
  state.imageState = "valid";
  state.paths = [];
  state.lanePosts = [];
  state.authorVisibility = "public";
  state.mediaViewer = PROFILE_ID;
  vi.stubEnv("SUPABASE_URL", "https://social-media.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://social-media.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-key");
  vi.stubEnv("SUPABASE_STORAGE_BUCKET", "pint-drops");
  vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
  vi.stubEnv("PLAN_IDEMPOTENCY_SECRET", "test-signing-secret-test-signing-secret");
  vi.stubEnv("ADMIN_TOKEN", "fixture-admin-token");
  vi.stubEnv("SOCIAL_MODERATOR_STAFF_ROLE_ID", STAFF_ID);
  vi.stubGlobal("fetch", fixtureFetch);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function serve(headers: HeadersInit = { authorization: "Bearer fixture-user-token" }): Promise<Response> {
  return GET(new Request(`https://app.test/api/social/media/${MEDIA_ID}`, { headers }), {
    params: Promise.resolve({ mediaId: MEDIA_ID }),
  });
}

// The signed read credential the session route mints beside the resume
// cookie: what the cookie lane authenticates ambient GETs by now (#3114).
function readCookie(userId: string | null = USER_ID): HeadersInit {
  const credential = userId ? mintAuthReadCredential(userId) : null;
  return { cookie: `${AUTH_READ_COOKIE}=${credential ?? ""}` };
}

function refreshes(): number {
  return state.paths.filter((path) => path === "/auth/v1/token").length;
}

function downloads(): string[] {
  return state.paths.filter((path) => path.startsWith("/storage/v1/object/"));
}

async function expectPhoto(response: Response): Promise<void> {
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(response.headers.get("content-length")).toBe(String(JPEG.byteLength));
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
}

it("serves authorized bytes and refuses the retained route URL after permission withdrawal", async () => {
  await expectPhoto(await serve());
  expect(downloads()).toEqual([`/storage/v1/object/pint-drops/${OBJECT_KEY}`]);
  state.authorized = false;
  const withdrawn = await serve();
  expect(withdrawn.status).toBe(404);
  expect(withdrawn.headers.get("location")).toBeNull();
  expect(withdrawn.headers.get("cache-control")).toBe("private, no-store");
  expect(await withdrawn.text()).not.toContain(OBJECT_KEY);
  expect(downloads()).toHaveLength(1);
});

it("serves moderator bytes and checks the staff role again before the next download", async () => {
  const preview = () => adminGET(new Request(`https://app.test/api/admin/social-posts/media/${MEDIA_ID}`, {
    headers: { "x-admin-token": "fixture-admin-token" },
  }), { params: Promise.resolve({ mediaId: MEDIA_ID }) });
  await expectPhoto(await preview());
  state.staffActive = false;
  const revoked = await preview();
  expect(revoked.status).toBe(503);
  expect(revoked.headers.get("location")).toBeNull();
  expect(revoked.headers.get("cache-control")).toBe("private, no-store");
  expect(await revoked.text()).not.toContain(OBJECT_KEY);
  expect(downloads()).toHaveLength(1);
});

it("preserves native image requests authenticated by the read credential", async () => {
  await expectPhoto(await serve(readCookie()));
  // The credential verifies locally: the refresh grant is never touched.
  expect(state.paths).not.toContain("/auth/v1/token");
  expect(state.paths).not.toContain("/auth/v1/user");
});

it("never spends the refresh token an ambient GET carries in the resume cookie", async () => {
  // Issue #3114: the resume cookie's token and the browser's stored token are
  // one chain, and a cookie lane that spent it could not write the successor
  // back. The lane must not even ASK GoTrue — the resume cookie alone no
  // longer authenticates a read.
  const cookie = encodeAuthResumeCookie({ refreshToken: "fixture-refresh-token", email: null });
  const response = await serve({ cookie: `${AUTH_RESUME_COOKIE}=${cookie}` });
  expect(response.status).toBe(404);
  expect(state.paths).not.toContain("/auth/v1/token");
});

it("preserves the moderator session-cookie image request", async () => {
  const session = await createModeratorSession(new Request("https://app.test/api/admin/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "fixture-admin-token" }),
  }));
  expect(session.status).toBe(200);
  const cookie = session.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();
  await expectPhoto(await adminGET(new Request(`https://app.test/api/admin/social-posts/media/${MEDIA_ID}`, {
    headers: { cookie: cookie! },
  }), { params: Promise.resolve({ mediaId: MEDIA_ID }) }));
});

it("refuses an anonymous retained URL the London lane does not show, without consulting media or Storage", async () => {
  // The signed-out door asks the lane's own rule first. No post in the lane
  // holds this photo, so the media read and Storage are never reached.
  const response = await serve({});
  expect(response.status).toBe(404);
  expect(response.headers.get("location")).toBeNull();
  expect(state.paths).not.toContain("/rest/v1/rpc/read_social_post_media");
  expect(downloads()).toEqual([]);
});

it("serves a London lane photo to a signed-out reader, and only while the post stays in the lane", async () => {
  state.mediaViewer = null;
  state.lanePosts = [londonLaneRow()];
  await expectPhoto(await serve({}));
  expect(state.paths).not.toContain("/auth/v1/user");
  expect(downloads()).toHaveLength(1);

  const refusals: Array<[string, () => void]> = [
    ["a patch outside London", () => { state.lanePosts = [londonLaneRow({ area_slug: "manchester-city-centre" })]; }],
    ["no area at all", () => { state.lanePosts = [londonLaneRow({ area_slug: null })]; }],
    ["a mutuals-only post", () => { state.lanePosts = [londonLaneRow({ visibility: "friends" })]; }],
    ["a post still in review", () => { state.lanePosts = [londonLaneRow({ moderation_state: "needs_review" })]; }],
    ["a hidden post", () => { state.lanePosts = [londonLaneRow({ status: "hidden" })]; }],
    ["a private account", () => { state.lanePosts = [londonLaneRow()]; state.authorVisibility = "private"; }],
  ];
  for (const [label, arrange] of refusals) {
    state.authorVisibility = "public";
    arrange();
    const refused = await serve({});
    expect(refused.status, label).toBe(404);
  }
  expect(downloads(), "no refused photo reaches Storage").toHaveLength(1);

  state.lanePosts = [londonLaneRow()];
  state.authorVisibility = "public";
  vi.stubEnv("PUBMAX_SOCIAL_FREEZE", "social");
  expect((await serve({})).status, "the freeze pauses the signed-out door").toBe(404);
  vi.stubEnv("PUBMAX_SOCIAL_FREEZE", "");
  vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");
  expect((await serve({})).status, "the launch rollback pauses it").toBe(404);
  expect(downloads()).toHaveLength(1);
});

it("keeps the signed-out photo door's per-IP budget ahead of the lane rule and Storage", async () => {
  state.mediaViewer = null;
  state.lanePosts = [londonLaneRow()];
  state.limited = true;
  const response = await serve({});
  expect(response.status).toBe(404);
  expect(state.paths).toContain("/rest/v1/rpc/check_rate_limit");
  expect(state.paths).not.toContain("/rest/v1/social_posts");
  expect(downloads()).toEqual([]);
});

it("keeps the read budget ahead of media authorization and download", async () => {
  state.limited = true;
  const response = await serve();
  expect(response.status).toBe(404);
  expect(state.paths).not.toContain("/rest/v1/rpc/read_social_post_media");
  expect(downloads()).toEqual([]);
});

it.each(["missing", "corrupt"] as const)("withholds %s Storage objects without issuing another access URL", async (imageState) => {
  state.imageState = imageState;
  const response = await serve();
  expect(response.status).toBe(404);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.text()).not.toContain(OBJECT_KEY);
  expect(downloads()).toEqual([`/storage/v1/object/pint-drops/${OBJECT_KEY}`]);
});

it("keeps a reader signed in while ambient reads and the browser's refreshes run in parallel", async () => {
  // The browser's client and the resume cookie hold one token. Two pages of
  // photos load hours apart; the browser refreshes its own token in between.
  // The reads authenticate by the signed credential alone, so the chain is
  // never touched from this lane and the browser's refresh is never reuse.
  const browserToken = gotrueSession();
  const start = Date.now();
  const now = vi.spyOn(Date, "now").mockReturnValue(start);
  for (const page of [1, 2]) {
    now.mockReturnValue(start + page * (GOTRUE_REUSE_INTERVAL_MS + 1_000));
    await expectPhoto(await serve(readCookie()));
  }
  expect(refreshes(), "no ambient read spends the refresh chain").toBe(0);
  now.mockReturnValue(start + 60 * 60_000);
  expect(gotrueRefresh(browserToken), "the browser's own refresh is not read as token reuse").toMatchObject({ ok: true });
  expect(gotrue.revoked).toBe(false);
  await expectPhoto(await serve(readCookie()));
});

it("blocks another browser refresh until refused cookie persistence succeeds", async () => {
  vi.useFakeTimers();
  let cookieToken = gotrueSession();
  let acceptedWrites = 0;
  const persistence = createResumePersistence();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/auth/session") {
      if (!acceptedWrites) return Response.json({}, { status: 429 });
      acceptedWrites -= 1;
      cookieToken = (JSON.parse(String(init?.body)) as { refreshToken: string }).refreshToken;
      return Response.json({ status: "stored" });
    }
    return fixtureFetch(input, init);
  });
  const browserFetch = persistence.wrapFetch(fixtureFetch, null);
  const refresh = (token: string) => browserFetch("https://social-media.test/auth/v1/token?grant_type=refresh_token", {
    method: "POST", body: JSON.stringify({ refresh_token: token }),
  });

  await expectPhoto(await serve(readCookie()));
  const first = await refresh("gotrue-0");
  const firstPersist = persistence.persist({ access_token: "fixture-access-token", refresh_token: "gotrue-1", user: { id: USER_ID } }, null);
  await vi.runAllTimersAsync();
  await expect(firstPersist).resolves.toBe(false);
  expect(await first.json()).toMatchObject({ refresh_token: "gotrue-1" });
  expect(cookieToken).toBe("gotrue-0");

  const blocked = refresh("gotrue-1");
  await vi.runAllTimersAsync();
  expect((await blocked).status).toBe(503);
  expect(gotrue.active).toBe("gotrue-1");
  expect((await browserFetch("https://social-media.test/auth/v1/user", {
    headers: { authorization: "Bearer fixture-user-token" },
  })).status).toBe(200);
  await expectPhoto(await serve(readCookie()));

  acceptedWrites = 1;
  const second = refresh("gotrue-1");
  await vi.runAllTimersAsync();
  expect(await (await second).json()).toMatchObject({ refresh_token: "gotrue-2" });
  const secondPersist = persistence.persist({ access_token: "fixture-access-token", refresh_token: "gotrue-2", user: { id: USER_ID } }, null);
  await vi.runAllTimersAsync();
  await expect(secondPersist).resolves.toBe(false);
  expect(cookieToken).toBe("gotrue-1");

  const blockedAgain = refresh("gotrue-2");
  await vi.runAllTimersAsync();
  expect((await blockedAgain).status).toBe(503);
  expect(gotrue.active).toBe("gotrue-2");
  await expectPhoto(await serve(readCookie()));
  expect(gotrue.revoked).toBe(false);
  await persistence.clear();
});

it("serves a page of concurrent photos on one credential, without touching GoTrue", async () => {
  const [first, second] = await Promise.all([serve(readCookie()), serve(readCookie())]);
  for (const response of [first, second]) {
    expect(response.headers.get("set-cookie")).toBeNull();
    await expectPhoto(response);
  }
  expect(refreshes()).toBe(0);
});

it("refuses a credential minted for another account, an expired one, and a forged one", async () => {
  const other = await serve(readCookie("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
  expect(other.status).toBe(404);

  const stale = mintAuthReadCredential(USER_ID, Date.now() - 2 * 24 * 60 * 60 * 1000)!;
  const expired = await serve({ cookie: `${AUTH_READ_COOKIE}=${stale}` });
  expect(expired.status).toBe(404);

  const [payload] = mintAuthReadCredential(USER_ID)!.split(".");
  const forged = await serve({ cookie: `${AUTH_READ_COOKIE}=${payload}.AAAA` });
  expect(forged.status).toBe(404);

  // No refusal ever asked GoTrue, and no refused photo reached Storage.
  expect(refreshes()).toBe(0);
  expect(downloads()).toEqual([]);
});

it("never lets an ambient cookie write to Social", async () => {
  // October 2026 audit: the cookie is an ambient credential; a write must
  // carry a bearer GoTrue checks every time. The read credential proves a GET,
  // never a POST.
  const post = (headers: HeadersInit) => createSocialPost(new Request("https://app.test/api/social/posts", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: "{}",
  }));
  await expectPhoto(await serve(readCookie()));

  const refused = await post(readCookie());
  expect(refused.status).toBe(401);
  expect(await refused.json()).toMatchObject({ code: "SOCIAL_SIGN_IN_REQUIRED" });
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const request = new Request("https://app.test/api/social/crews", { method, headers: readCookie() });
    expect(await requireVerifiedSocialActor(request)).toMatchObject({ ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED" });
  }
  expect(refreshes()).toBe(0);

  // A write with a bearer still resolves the actor, then meets the route's own checks.
  const signedIn = await post({ authorization: "Bearer fixture-user-token" });
  expect(signedIn.status).toBe(400);
  expect(await signedIn.json()).toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY" });
});
