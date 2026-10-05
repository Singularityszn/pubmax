import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pin in-memory rate limiting regardless of CI Supabase env (Vercel presets
// SUPABASE_*). Without this, isLimited hits the durable path and — when the
// RPC is missing — used to degrade to Math.min(limit, 3), so the 10×403 then
// 429 contract flaked on the 4th attempt.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    checkRateLimitDurableDetailed: async () =>
      ({ verdict: null, reason: "no-client" }) as const,
  };
});

vi.mock("@/lib/serverEnv", () => ({
  assertServerEnv: () => {},
  assertProductionSecrets: () => {},
}));

const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

async function loginCookie(): Promise<string> {
  const { POST } = await import("@/app/api/admin/session/route");
  const login = await POST(new Request("http://localhost/api/admin/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "test-admin-secret" }),
  }));
  expect(login.status).toBe(200);
  const [cookie] = (login.headers.get("set-cookie") ?? "").split(";");
  if (!cookie) throw new Error("login set no session cookie");
  return cookie;
}

async function expectRefusedCookie(cookie: string): Promise<void> {
  const { GET } = await import("@/app/api/admin/session/route");
  const { GET: readQueue } = await import("@/app/api/admin/comments/route");
  const { canOpenAdminDocument } = await import("@/lib/adminAuth");
  const headers = { cookie };
  expect((await readQueue(new Request("http://localhost/api/admin/comments", { headers }))).status).toBe(403);
  expect(await (await GET(new Request("http://localhost/api/admin/session", { headers }))).json()).toEqual({ authenticated: false });
  expect(canOpenAdminDocument(new Headers(headers))).toBe(false);
}

beforeEach(async () => {
  process.env.ADMIN_TOKEN = "test-admin-secret";
  const { __resetPintDrops } = await import("@/lib/pintDrops");
  __resetPintDrops();
  const { __resetMemoryComments } = await import("@/lib/commentsStore");
  __resetMemoryComments();
});

afterEach(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/admin/session", () => {
  it("sets an httpOnly session cookie when the token matches", async () => {
    const { POST } = await import("@/app/api/admin/session/route");
    const res = await POST(
      new Request("http://localhost/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "test-admin-secret" }),
      }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("pubmax_admin_session=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    // Lax, not Strict: GET /admin is gated on the document now, so the
    // top-level navigation to it has to carry this cookie. A browser withholds
    // a Strict cookie on a cross-site top-level navigation, which met a
    // moderator arriving from a pasted link with the token form.
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("returns 403 for a wrong token", async () => {
    const { POST } = await import("@/app/api/admin/session/route");
    const res = await POST(
      new Request("http://localhost/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "wrong" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("429s after too many login attempts from one IP", async () => {
    const { POST } = await import("@/app/api/admin/session/route");
    for (let i = 0; i < 10; i++) {
      const res = await POST(
        new Request("http://localhost/api/admin/session", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
          body: JSON.stringify({ token: "wrong" }),
        }),
      );
      expect(res.status).toBe(403);
    }
    const limited = await POST(
      new Request("http://localhost/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
        body: JSON.stringify({ token: "wrong" }),
      }),
    );
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "Too many attempts, slow down.", code: "RATE_LIMITED", retryable: true });
  });
});

describe("GET /api/admin/session", () => {
  it("expires a login cookie at 24 hours for session reads, queue reads, and document access", async () => {
    const issuedAt = Date.parse("2026-10-04T12:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(issuedAt);
    const { GET } = await import("@/app/api/admin/session/route");
    const { GET: readQueue } = await import("@/app/api/admin/comments/route");
    const { ADMIN_SESSION_MAX_AGE_SEC, canOpenAdminDocument } = await import("@/lib/adminAuth");
    const cookie = await loginCookie();
    const session = () => new Request("http://localhost/api/admin/session", { headers: { cookie } });
    const queue = () => new Request("http://localhost/api/admin/comments", { headers: { cookie } });
    expect(await (await GET(session())).json()).toEqual({ authenticated: true });
    expect((await readQueue(queue())).status).toBe(200);
    expect(canOpenAdminDocument(new Headers({ cookie }))).toBe(true);

    clock.mockReturnValue(issuedAt + (ADMIN_SESSION_MAX_AGE_SEC - 1) * 1000);
    expect((await readQueue(queue())).status).toBe(200);
    expect(canOpenAdminDocument(new Headers({ cookie }))).toBe(true);
    clock.mockReturnValue(issuedAt + ADMIN_SESSION_MAX_AGE_SEC * 1000);
    await expectRefusedCookie(cookie);
    clock.mockReturnValue(issuedAt + (ADMIN_SESSION_MAX_AGE_SEC + 1) * 1000);
    await expectRefusedCookie(cookie);
  });

  it("returns authenticated true when a valid session cookie is present", async () => {
    const { GET } = await import("@/app/api/admin/session/route");
    const cookie = await loginCookie();
    const res = await GET(
      new Request("http://localhost/api/admin/session", {
        headers: { cookie },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: true });
  });

  it("refuses legacy static-digest cookies", async () => {
    const digest = createHash("sha256").update("test-admin-secret").digest("hex");
    await expectRefusedCookie(`pubmax_admin_session=${digest}`);
  });

  it("refuses a signed session issued in the future", async () => {
    const issuedAt = Date.parse("2026-10-04T12:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(issuedAt);
    const cookie = await loginCookie();
    clock.mockReturnValue(issuedAt - 1000);
    await expectRefusedCookie(cookie);
  });

  it("refuses a session after the moderator token changes", async () => {
    const cookie = await loginCookie();
    process.env.ADMIN_TOKEN = "rotated-admin-secret";
    await expectRefusedCookie(cookie);
  });

  it.each([
    ["signature", (cookie: string) => cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a")],
    ["issuance time", (cookie: string) => cookie.replace(/\.(\d+)\./, (_, time: string) => `.${Number(time) - 1}.`)],
    ["version", (cookie: string) => cookie.replace("=v1.", "=v2.")],
  ])("refuses a session with a changed %s", async (_, change) => {
    await expectRefusedCookie(change(await loginCookie()));
  });

  it.each(["v1.1", "v1.nope.signature", "v1.9999999999999.signature", "", "%zz"])(
    "refuses malformed session data %j without throwing",
    async (value) => {
      await expectRefusedCookie(`pubmax_admin_session=${value}`);
    },
  );

  it("keeps valid header-token access when the cookie is invalid", async () => {
    const { GET } = await import("@/app/api/admin/session/route");
    const { GET: readQueue } = await import("@/app/api/admin/comments/route");
    const { canOpenAdminDocument } = await import("@/lib/adminAuth");
    const headers = { cookie: "pubmax_admin_session=%zz", "x-admin-token": "test-admin-secret" };
    expect((await readQueue(new Request("http://localhost/api/admin/comments", { headers }))).status).toBe(200);
    expect(await (await GET(new Request("http://localhost/api/admin/session", { headers }))).json()).toEqual({ authenticated: true });
    expect(canOpenAdminDocument(new Headers(headers))).toBe(true);
    await expectRefusedCookie("pubmax_admin_session=%zz");
  });
});

describe("moderation writes with session credentials", () => {
  it("refuses an expired cookie without changing the row and still accepts the header token", async () => {
    const issuedAt = Date.parse("2026-10-04T12:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(issuedAt);
    const cookie = await loginCookie();
    const { ADMIN_SESSION_MAX_AGE_SEC } = await import("@/lib/adminAuth");
    const { POST: moderate } = await import("@/app/api/admin/comments/route");
    const { commentsStore } = await import("@/lib/commentsStore");
    const store = commentsStore();
    const comment = await store.addComment({
      pintDropId: "session-expiry-drop",
      handle: "Moderator test",
      body: "Moderated row",
      actorHash: "session-expiry-actor",
    });
    const decision = (
      action: "restore" | "keep_hidden",
      headerToken?: string,
    ) => new Request("http://localhost/api/admin/comments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        ...(headerToken ? { "x-admin-token": headerToken } : {}),
      },
      body: JSON.stringify({ action, id: comment.id }),
    });

    expect((await moderate(decision("keep_hidden"))).status).toBe(200);
    expect(await store.listComments("session-expiry-drop")).toEqual([]);
    clock.mockReturnValue(issuedAt + ADMIN_SESSION_MAX_AGE_SEC * 1000);
    const refused = await moderate(decision("restore"));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "Not authorised.", code: "FORBIDDEN", retryable: false });
    expect(await store.listComments("session-expiry-drop")).toEqual([]);
    expect(await store.listForReview("hidden")).toEqual([expect.objectContaining({ id: comment.id })]);

    expect((await moderate(decision("restore", "test-admin-secret"))).status).toBe(200);
    expect(await store.listComments("session-expiry-drop")).toEqual([comment]);
    expect(await store.listForReview("hidden")).toEqual([]);
  });
});

describe("DELETE /api/admin/session", () => {
  it("clears the session cookie", async () => {
    const { DELETE } = await import("@/app/api/admin/session/route");
    const res = await DELETE();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("includes Secure on the cleared cookie in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { DELETE } = await import("@/app/api/admin/session/route");
    const res = await DELETE();
    expect(res.headers.get("set-cookie") ?? "").toContain("Secure");
  });
});
