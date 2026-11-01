import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { GET } from "@/app/api/social/media/[mediaId]/route";
import { GET as adminGET } from "@/app/api/admin/social-posts/media/[mediaId]/route";
import { POST as createModeratorSession } from "@/app/api/admin/session/route";
import { POST as createSocialPost } from "@/app/api/social/posts/route";
import { AUTH_RESUME_COOKIE, decodeAuthResumeCookie, encodeAuthResumeCookie } from "@/lib/authSessionResume";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";

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
  refreshFailures: 0,
  revoked: false,
};

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
    if (state.revoked) return json({ error: "invalid_grant" }, 400);
    const body = JSON.parse(String(init?.body)) as { refresh_token?: string };
    if (body.refresh_token === "fixture-refresh-token") return json({ user: { id: USER_ID } });
    // A rotating token answers the way GoTrue does: a fresh pair, the old one spent.
    if (body.refresh_token?.startsWith("fixture-rotating-")) {
      if (state.refreshFailures > 0) {
        state.refreshFailures -= 1;
        return json({ code: "over_request_rate_limit" }, 429);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      return json({
        access_token: "fixture-access-token",
        refresh_token: `${body.refresh_token}-rotated`,
        user: { id: USER_ID, email: "alice@example.test" },
      });
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
    return json([{ id: PROFILE_ID, handle: "alice", user_id: USER_ID }]);
  }
  if (url.pathname === "/rest/v1/private_account_identities") return json([{ date_of_birth: "1990-01-01" }]);
  if (url.pathname === "/rest/v1/adult_self_assertions") return json([]);
  if (url.pathname === "/rest/v1/rpc/check_rate_limit") return json(state.limited);
  if (url.pathname === "/rest/v1/rpc/read_social_post_media") {
    const body = JSON.parse(String(init?.body)) as { p_viewer: string; p_media_id: string };
    expect(body).toEqual({ p_viewer: PROFILE_ID, p_media_id: MEDIA_ID });
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
  state.refreshFailures = 0;
  state.revoked = false;
  vi.stubEnv("SUPABASE_URL", "https://social-media.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://social-media.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-key");
  vi.stubEnv("SUPABASE_STORAGE_BUCKET", "pint-drops");
  vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
  vi.stubEnv("ADMIN_TOKEN", "fixture-admin-token");
  vi.stubEnv("SOCIAL_MODERATOR_STAFF_ROLE_ID", STAFF_ID);
  vi.stubGlobal("fetch", fixtureFetch);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function serve(headers: HeadersInit = { authorization: "Bearer fixture-user-token" }): Promise<Response> {
  return GET(new Request(`https://app.test/api/social/media/${MEDIA_ID}`, { headers }), {
    params: Promise.resolve({ mediaId: MEDIA_ID }),
  });
}

function resumeCookie(refreshToken: string): HeadersInit {
  return { cookie: `${AUTH_RESUME_COOKIE}=${encodeAuthResumeCookie({ refreshToken, email: null })}` };
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

it("preserves native image requests authenticated by the resume cookie", async () => {
  const cookie = encodeAuthResumeCookie({ refreshToken: "fixture-refresh-token", email: null });
  await expectPhoto(await serve({ cookie: `${AUTH_RESUME_COOKIE}=${cookie}` }));
  expect(state.paths).toContain("/auth/v1/token");
  expect(state.paths).not.toContain("/auth/v1/user");
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

it("refuses an anonymous retained URL without consulting media or Storage", async () => {
  const response = await serve({});
  expect(response.status).toBe(404);
  expect(response.headers.get("location")).toBeNull();
  expect(state.paths).toEqual([]);
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

// Each test below presents its own token: the cookie lane remembers a verified
// token briefly, so a shared one would answer from memory.
it("writes the rotated refresh token back to the resume cookie on the photo", async () => {
  const response = await serve(resumeCookie("fixture-rotating-write"));
  const setCookie = response.headers.get("set-cookie") ?? "";
  await expectPhoto(response);
  expect(setCookie).toMatch(new RegExp(`^${AUTH_RESUME_COOKIE}=`));
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Lax");
  const value = decodeURIComponent((setCookie.split(";")[0] ?? "").slice(AUTH_RESUME_COOKIE.length + 1));
  expect(decodeAuthResumeCookie(value)).toEqual({
    refreshToken: "fixture-rotating-write-rotated",
    email: "alice@example.test",
    userId: USER_ID,
  });
});

it("redeems one token once for a page of concurrent photos", async () => {
  const [first, second] = await Promise.all([
    serve(resumeCookie("fixture-rotating-page")),
    serve(resumeCookie("fixture-rotating-page")),
  ]);
  expect(refreshes()).toBe(1);
  for (const response of [first, second]) {
    expect(response.headers.get("set-cookie")).toContain(
      encodeURIComponent(encodeAuthResumeCookie({
        refreshToken: "fixture-rotating-page-rotated",
        email: "alice@example.test",
        userId: USER_ID,
      })),
    );
    await expectPhoto(response);
  }
  await expectPhoto(await serve(resumeCookie("fixture-rotating-page")));
  expect(refreshes()).toBe(1);
  await expectPhoto(await serve(resumeCookie("fixture-rotating-page-rotated")));
  expect(refreshes()).toBe(2);
});

it("refuses a revoked rotated token before serving another photo", async () => {
  await expectPhoto(await serve(resumeCookie("fixture-rotating-revoked")));
  state.revoked = true;
  const response = await serve(resumeCookie("fixture-rotating-revoked-rotated"));
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain(OBJECT_KEY);
  expect(refreshes()).toBe(2);
  expect(downloads()).toHaveLength(1);
});

it("refuses a revoked presented token after three seconds", async () => {
  const start = Date.now();
  const now = vi.spyOn(Date, "now").mockReturnValue(start);
  await expectPhoto(await serve(resumeCookie("fixture-rotating-expired")));
  state.revoked = true;
  now.mockReturnValue(start + 3_001);
  const response = await serve(resumeCookie("fixture-rotating-expired"));
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain(OBJECT_KEY);
  expect(refreshes()).toBe(2);
  expect(downloads()).toHaveLength(1);
});

it("never remembers a refused refresh as a sign-in", async () => {
  state.refreshFailures = 1;
  const refused = await serve(resumeCookie("fixture-rotating-refused"));
  expect(refused.status).toBe(404);
  expect(refused.headers.get("set-cookie")).toBeNull();
  await expectPhoto(await serve(resumeCookie("fixture-rotating-refused")));
  expect(refreshes()).toBe(2);
});

it("never lets the resume cookie alone write to Social", async () => {
  // October 2026 audit: the lane remembered a verified token for a minute, so a
  // token GoTrue had since revoked still wrote as the account. The cookie is an
  // ambient credential; a write must carry a bearer GoTrue checks every time.
  const post = (headers: HeadersInit) => createSocialPost(new Request("https://app.test/api/social/posts", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: "{}",
  }));
  await expectPhoto(await serve(resumeCookie("fixture-rotating-writes")));
  expect(refreshes()).toBe(1);

  for (const token of ["fixture-rotating-writes", "fixture-rotating-writes-rotated"]) {
    const refused = await post(resumeCookie(token));
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ code: "SOCIAL_SIGN_IN_REQUIRED" });
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const request = new Request("https://app.test/api/social/crews", { method, headers: resumeCookie("fixture-rotating-writes") });
    expect(await requireVerifiedSocialActor(request)).toMatchObject({ ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED" });
  }
  // No redeem is attempted for a write.
  expect(refreshes()).toBe(1);

  // A write with a bearer still resolves the actor, then meets the route's own checks.
  const signedIn = await post({ authorization: "Bearer fixture-user-token" });
  expect(signedIn.status).toBe(400);
  expect(await signedIn.json()).toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY" });
});
