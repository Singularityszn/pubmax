import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for app/api/admin/comments/route.ts (story 37). With
// Supabase env cleared the route uses the in-memory commentsStore, and with
// ADMIN_TOKEN unset the moderator gate opens in the test runner (see
// lib/adminAuth.ts) — so the queue + moderation actions are deterministic.

import { GET, POST } from "@/app/api/admin/comments/route";
import { __addMemoryCommentForTest, __resetMemoryComments } from "@/lib/commentsStore";

const URL_BASE = "http://localhost/api/admin/comments";

function get(query?: string, headers?: Record<string, string>): Promise<Response> {
  return GET(new Request(query ? `${URL_BASE}?${query}` : URL_BASE, { headers }));
}
function post(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return POST(new Request(URL_BASE, { method: "POST", body: JSON.stringify(body), headers }));
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ADMIN_TOKEN; // gate opens in test
  __resetMemoryComments();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/admin/comments — hidden queue", () => {
  it("returns hidden comments (status + drop id, no actor_hash)", async () => {
    __addMemoryCommentForTest("drop-1", {
      handle: "ale",
      body: "hidden one",
      actorHash: "secret",
      status: "hidden",
    });
    const res = await get("status=hidden");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { comments: { body: string }[] };
    expect(body.comments).toHaveLength(1);
    expect(JSON.stringify(body.comments)).not.toContain("secret");
  });

  it("403s when a real ADMIN_TOKEN is set and the header is wrong", async () => {
    vi.stubEnv("ADMIN_TOKEN", "the-real-token");
    const res = await get("status=hidden", { "x-admin-token": "wrong" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/comments — moderation", () => {
  it("restores a hidden comment", async () => {
    __addMemoryCommentForTest("drop-1", {
      handle: "ale",
      body: "rescue",
      actorHash: "h",
      status: "hidden",
    });
    const [target] = (await (await get("status=hidden")).json()).comments;
    const res = await post({ action: "restore", id: target.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("400s an unknown action", async () => {
    const res = await post({ action: "nuke", id: "x" });
    expect(res.status).toBe(400);
  });

  it("404s an unknown comment id", async () => {
    const res = await post({ action: "restore", id: "no-such-id" });
    expect(res.status).toBe(404);
  });
});
