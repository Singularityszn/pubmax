import { beforeEach, describe, expect, it, vi } from "vitest";

// The route calls assertServerEnv() at module scope (the house pattern shared by
// 40+ certified routes). On Vercel vitest reads as production without test-scoped
// Supabase vars, so importing the module would throw "FATAL: Supabase is not
// configured in production" before any test runs. Mock serverEnv to a no-op — the
// same guard every sibling route test uses (see followingRoute.test.ts) — and
// clear the Supabase env in beforeEach so the memory backend is forced on Vercel.
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { GET } from "@/app/api/profiles/[handle]/lot/route";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryFollows();
  __resetMemoryProfiles();
});

function call(handle: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/profiles/${handle}/lot`), {
    params: Promise.resolve({ handle }),
  });
}

describe("GET /api/profiles/[handle]/lot", () => {
  it("returns the mutual-follow handles (the lot)", async () => {
    const s = followStore();
    await s.follow("karan", "amy");
    await s.follow("amy", "karan");
    await s.follow("karan", "ben"); // one-way, not in the lot

    const res = await call("karan");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { lot: string[] };
    expect(data.lot).toEqual(["amy"]);
  });

  it("returns an empty lot for an empty handle (never 400)", async () => {
    const res = await GET(new Request("http://localhost/api/profiles//lot"), {
      params: Promise.resolve({ handle: "" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { lot: string[] }).toEqual({ lot: [] });
  });
});
