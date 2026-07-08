import { beforeEach, describe, expect, it, vi } from "vitest";

// Pin the route to the process-memory backend even on Vercel, where production
// Supabase env vars are present. This follows the house pattern for social route
// tests: backend selection is at the @/lib/supabase seam, not NODE_ENV.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { POST } from "@/app/api/profiles/[handle]/follow/route";
import { __resetMemoryFollows } from "@/lib/followStore";
import { __resetMemoryNotifications } from "@/lib/notificationsStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

const URL_BASE = "http://localhost/api/profiles";

function follow(target: string, body: unknown): Promise<Response> {
  return POST(
    new Request(`${URL_BASE}/${encodeURIComponent(target)}/follow`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ handle: target }) },
  );
}

function expectNoStore(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryFollows();
  __resetMemoryNotifications();
  __resetMemoryProfiles();
});

describe("POST /api/profiles/[handle]/follow", () => {
  it("follows another handle and marks the personalized response no-store", async () => {
    const res = await follow("sam", { follower: "ken" });
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({
      following: true,
      counts: { followers: 1, following: 0 },
    });
  });

  it("rejects self-follows with no-store headers", async () => {
    const res = await follow("sam", { follower: "@Sam" });
    expect(res.status).toBe(400);
    expectNoStore(res);
    expect(await res.json()).toEqual({ error: "You can't follow yourself." });
  });
});
