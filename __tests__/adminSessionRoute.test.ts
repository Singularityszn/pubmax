import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({
  assertServerEnv: () => {},
  assertProductionSecrets: () => {},
}));

const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

beforeEach(() => {
  process.env.ADMIN_TOKEN = "test-admin-secret";
});

afterEach(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
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
});

describe("GET /api/admin/session", () => {
  it("returns authenticated true when a valid session cookie is present", async () => {
    const { hashAdminSession } = await import("@/lib/adminAuth");
    const { GET } = await import("@/app/api/admin/session/route");
    const cookie = `pubmax_admin_session=${encodeURIComponent(hashAdminSession("test-admin-secret"))}`;
    const res = await GET(
      new Request("http://localhost/api/admin/session", {
        headers: { cookie },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: true });
  });
});

describe("DELETE /api/admin/session", () => {
  it("clears the session cookie", async () => {
    const { DELETE } = await import("@/app/api/admin/session/route");
    const res = await DELETE();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("Max-Age=0");
  });
});
