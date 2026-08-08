import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HANDLE_PASSWORD_GENERIC_ERROR } from "@/lib/handlePasswordConstants";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const limitState = vi.hoisted(() => ({ limited: false }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return {
    ...actual,
    isLimited: async () => limitState.limited,
  };
});

const resolveEmail = vi.hoisted(() => vi.fn());
const passwordGrant = vi.hoisted(() => vi.fn());
vi.mock("@/lib/handlePasswordSignIn", () => ({
  resolveAuthEmailForHandle: resolveEmail,
  signInWithEmailPassword: passwordGrant,
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => true,
  };
});

const SUPABASE_URL = "https://mock-project.supabase.co";

function post(body: unknown): Request {
  return new Request("http://localhost/api/auth/handle-password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  limitState.limited = false;
  resolveEmail.mockReset();
  passwordGrant.mockReset();
  const { __resetPintDrops } = await import("@/lib/pintDrops");
  __resetPintDrops();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/auth/handle-password", () => {
  it("returns the same generic error for unknown handle and wrong password", async () => {
    const { POST } = await import("@/app/api/auth/handle-password/route");

    resolveEmail.mockResolvedValueOnce(null);
    const unknown = await POST(post({ handle: "ghost", password: "secretpass" }));
    expect(unknown.status).toBe(401);
    expect((await unknown.json()).error).toBe(HANDLE_PASSWORD_GENERIC_ERROR);

    resolveEmail.mockResolvedValueOnce("owner@example.com");
    passwordGrant.mockResolvedValueOnce(null);
    const wrong = await POST(post({ handle: "karan", password: "secretpass" }));
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error).toBe(HANDLE_PASSWORD_GENERIC_ERROR);
  });

  it("returns a session and resume cookie on success", async () => {
    const { POST } = await import("@/app/api/auth/handle-password/route");
    resolveEmail.mockResolvedValue("owner@example.com");
    passwordGrant.mockResolvedValue({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
    });

    const res = await POST(post({ handle: "karan", password: "secretpass" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("signed_in");
    expect(body.session).toMatchObject({
      access_token: "access-1",
      refresh_token: "refresh-1",
    });
    expect(body.session.email).toBeUndefined();
    expect(res.headers.get("set-cookie")).toMatch(/pubmax_session_resume=/i);
  });

  it("rate limits repeated attempts", async () => {
    limitState.limited = true;
    const { POST } = await import("@/app/api/auth/handle-password/route");
    const res = await POST(post({ handle: "karan", password: "secretpass" }));
    expect(res.status).toBe(429);
    expect(resolveEmail).not.toHaveBeenCalled();
  });

  it("rejects cross-site posts", async () => {
    const { POST } = await import("@/app/api/auth/handle-password/route");
    const res = await POST(
      new Request("http://localhost/api/auth/handle-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ handle: "karan", password: "secretpass" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
