import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as RuntimeRequest } from "next/dist/compiled/@edge-runtime/primitives/fetch";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/supabase")>();
  const admin = {
    auth: {
      getUser: async (token: string) => token === "fixture-bearer"
        ? { data: { user: { id: "user-me" } }, error: null }
        : { data: { user: null }, error: { status: 401 } },
    },
    rpc: async () => ({ data: [{ ok: true, product_account_id: "account-me", provisioned: false }], error: null }),
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          limit: async () => {
            const rows: Record<string, unknown[]> = {
              private_social_accounts: [{ id: "account-me", clerk_user_id: "fixture-account", profile_id: "profile-me", ownership_state: "active" }],
              profiles: [{ id: "profile-me", handle: "presence_me_p0", user_id: "user-me" }],
              private_account_identities: [{ date_of_birth: "1990-01-01" }],
            };
            if (!(table in rows)) throw new Error(`Unexpected table ${table}`);
            return { data: rows[table], error: null };
          },
        }),
      }),
    }),
  };
  return { ...original, getSupabaseAdmin: () => admin, requireSupabaseAdmin: () => admin };
});

import { GET } from "@/app/api/presence/route";
import { AUTH_RESUME_COOKIE, encodeAuthResumeCookie } from "@/lib/authSessionResume";
import { __resetPresence, markPresence } from "@/lib/presenceStore";
import type { PresenceDTO } from "@/lib/presence";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";

const ME = "presence_me_p0";
const VENUE = "venue-16pnwmm";

beforeEach(async () => {
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://presence-auth.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-key");
  vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
  vi.stubEnv("NEXT_PUBLIC_DEMO_CONTENT", "on");
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-11-07T20:00:00Z").getTime());
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe("https://presence-auth.test/auth/v1/token");
    expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: "fixture-refresh-token" });
    return Response.json({ user: { id: "user-me" }, refresh_token: "fixture-rotated-token" });
  }));
  __seedMemoryOwnedProfile(ME, "user-me");
  await markPresence({ handle: ME, venueId: VENUE, actorHash: "actor-me" });
});

afterEach(() => {
  __resetPresence();
  __resetMemoryProfiles();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each(["/api/presence", `/api/presence?venueId=${VENUE}`])("%s bearer boundary", (path) => {
  it("refuses real rows from a valid resume cookie while preserving demo rows", async () => {
    const request = new Request(`https://app.test${path}`, {
      headers: { cookie: `${AUTH_RESUME_COOKIE}=${encodeAuthResumeCookie({ refreshToken: "fixture-refresh-token", email: null })}` },
    });
    expect(await requireVerifiedSocialActor(request)).toMatchObject({ ok: true });

    const response = await GET(request);
    const { presence } = await response.json() as { presence: PresenceDTO[] };
    expect(presence.filter((row) => row.provenance !== "demo")).toEqual([]);
    expect(presence.length).toBeGreaterThan(0);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("continues to return real rows for a verified bearer", async () => {
    const response = await GET(new Request(`https://app.test${path}`, {
      headers: { authorization: "Bearer fixture-bearer" },
    }));
    const { presence } = await response.json() as { presence: PresenceDTO[] };
    expect(presence.filter((row) => row.provenance !== "demo").map((row) => row.handle)).toEqual([ME]);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns the viewer's row when Next supplies its runtime Request implementation", async () => {
    // The launch presence contract permits the verified viewer's own row.
    // Next's request uses a different Request implementation from Node's.
    // A clone that treats this request as a URL must not hide every check-in.
    const response = await GET(new RuntimeRequest(`https://app.test${path}`, {
      headers: { authorization: "Bearer fixture-bearer" },
    }));
    const { presence } = await response.json() as { presence: PresenceDTO[] };
    expect(presence.filter((row) => row.provenance !== "demo").map((row) => row.handle)).toEqual([ME]);
  });

  it.each([false, true])("returns only demo rows for a bearerless runtime request with resume cookie %s", async (withCookie) => {
    const response = await GET(new RuntimeRequest(`https://app.test${path}`, {
      headers: withCookie
        ? { cookie: `${AUTH_RESUME_COOKIE}=${encodeAuthResumeCookie({ refreshToken: "fixture-refresh-token", email: null })}` }
        : {},
    }));
    const { presence } = await response.json() as { presence: PresenceDTO[] };
    expect(presence.length).toBeGreaterThan(0);
    expect(presence.every((row) => row.provenance === "demo")).toBe(true);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
