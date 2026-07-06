import { beforeEach, describe, expect, it } from "vitest";

// Handler-level coverage for the GET of
// app/api/profiles/[handle]/following/route.ts — the read that powers the
// Friends feed lane (lib/feed.ts fetches the viewer's followees, then keeps only
// drops authored by a handle in the returned set).
//
// The route's whole contract is "a pure read that MUST NEVER 500": a bad handle
// or a backend hiccup degrades to `{ following: [] }` so the feed still renders.
// We pin the process-memory backend so every case is deterministic and touches
// no network — on Vercel vitest inherits the project env, so SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY are cleared in beforeEach to force the memory path
// everywhere (otherwise the store would try to reach Supabase and only CI would
// fail). We also reset the shared memory follow edges + handle index AND the
// memory profile map (follow/ensure writes profiles) so cases can't leak state.
//
// We seed follows through the memory followStore's PUBLIC api (follow(...)) — the
// same seam the route reads from — never by reaching into store internals.

import { GET } from "@/app/api/profiles/[handle]/following/route";
import { memoryFollowStore, __resetMemoryFollows } from "@/lib/followStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

const URL_BASE = "http://localhost/api/profiles";

// The route's second arg is `{ params: Promise<{ handle }> }` (Next 15 async
// params). Build a real resolved Promise so we exercise the exact signature.
function following(handle: string): Promise<Response> {
  const request = new Request(`${URL_BASE}/${encodeURIComponent(handle)}/following`);
  return GET(request, { params: Promise.resolve({ handle }) });
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryFollows();
  __resetMemoryProfiles();
});

describe("GET /api/profiles/[handle]/following", () => {
  it("returns the normalized handles a handle follows", async () => {
    await memoryFollowStore.follow("ken", "sam");
    await memoryFollowStore.follow("ken", "lee");

    const res = await following("ken");
    expect(res.status).toBe(200);
    const body = await res.json();
    // Order isn't part of the contract — compare as a set.
    expect(new Set(body.following)).toEqual(new Set(["sam", "lee"]));
    // Every entry is a normalized handle, never a raw id.
    for (const h of body.following) expect(h).toMatch(/^[a-z0-9_]+$/);
  });

  it("returns { following: [] } for a handle that follows nobody", async () => {
    // Give ken a profile (as a followee) but no OUTGOING edges of his own.
    await memoryFollowStore.follow("sam", "ken");

    const res = await following("ken");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ following: [] });
  });

  it("returns { following: [] } for an unknown handle with no profile at all", async () => {
    const res = await following("ghost");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ following: [] });
  });

  it("normalizes the queried handle before resolving its followees", async () => {
    await memoryFollowStore.follow("ken", "sam");

    // "@Ken" and "KEN" collapse to the same identity as the seeded "ken".
    const atKen = await following("@Ken");
    expect(await atKen.json()).toEqual({ following: ["sam"] });

    const upperKen = await following("KEN");
    expect(await upperKen.json()).toEqual({ following: ["sam"] });
  });

  it("never 500s on an empty handle — returns { following: [] }, not a 400/500", async () => {
    const res = await following("");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ following: [] });
  });

  it("never 500s on a blank / junk handle that normalizes to empty", async () => {
    // Whitespace, a bare "@", and off-alphabet junk all normalize to "" — the
    // route's empty-handle branch returns the uniform empty shape (never a 400).
    for (const junk of ["   ", "@", "@@@", "!!!", "###"]) {
      const res = await following(junk);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ following: [] });
    }
  });

  it("isolates one follower's followees from another's", async () => {
    await memoryFollowStore.follow("ken", "sam");
    await memoryFollowStore.follow("lee", "zoe");

    expect(await (await following("ken")).json()).toEqual({ following: ["sam"] });
    expect(await (await following("lee")).json()).toEqual({ following: ["zoe"] });
  });

  it("reflects an unfollow — the dropped followee leaves the list", async () => {
    await memoryFollowStore.follow("ken", "sam");
    await memoryFollowStore.follow("ken", "lee");
    await memoryFollowStore.unfollow("ken", "sam");

    const res = await following("ken");
    expect(await res.json()).toEqual({ following: ["lee"] });
  });

  it("returns a JSON body of exactly { following } and leaks no profile_id / actor_hash / raw id", async () => {
    await memoryFollowStore.follow("ken", "sam");

    const res = await following("ken");
    const body = await res.json();
    // The public shape is exactly one key: `following`.
    expect(Object.keys(body)).toEqual(["following"]);

    // The serialized response must not leak any internal identifier. The memory
    // profile id is `mem-profile-<handle>`; the Supabase edge carries profile_id
    // / follower_id / followee_id / actor_hash — none may cross the wire.
    const blob = JSON.stringify(body);
    expect(blob).not.toMatch(/mem-profile-/i);
    expect(blob).not.toMatch(/profile_?id/i);
    expect(blob).not.toMatch(/follower_?id/i);
    expect(blob).not.toMatch(/followee_?id/i);
    expect(blob).not.toMatch(/actor_?hash/i);
  });

  it("advertises a JSON response and never a non-200 status", async () => {
    await memoryFollowStore.follow("ken", "sam");
    const res = await following("ken");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
  });
});
