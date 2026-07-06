import { beforeEach, describe, expect, it } from "vitest";

// Route-level ownership enforcement for PATCH /api/profiles/[handle] (story 31).
//
// The REAL security boundary lives here (writes go through the service role, so
// RLS is bypassed — see lib/profileOwnership.ts + migration 0009). We pin the
// in-memory backend (clear Supabase env, repo convention) so every case is
// deterministic and network-free. In memory mode there is no JWT verifier, so a
// request is always resolved as ANONYMOUS — which is exactly the caller we need
// to prove the two contract points:
//   • an anonymous write to an UNLINKED handle still succeeds (demo preserved);
//   • an anonymous write to a handle already LINKED to a user is REJECTED (403)
//     — the hijack the ownership gate exists to stop.
// The owner-accepted path is covered by the pure decideProfileWrite tests.

import { PATCH } from "@/app/api/profiles/[handle]/route";
import { memoryProfileStore, __resetMemoryProfiles } from "@/lib/profileStore";

const URL_BASE = "http://localhost/api/profiles";

function patch(handle: string, body: unknown): Promise<Response> {
  const request = new Request(`${URL_BASE}/${encodeURIComponent(handle)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(request, { params: Promise.resolve({ handle }) });
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryProfiles();
});

describe("PATCH /api/profiles/[handle] — ownership gate", () => {
  it("allows an anonymous edit of an UNLINKED handle (demo path stands)", async () => {
    const res = await patch("ken", { displayName: "Cheap Pint Ken" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.displayName).toBe("Cheap Pint Ken");
  });

  it("REJECTS an anonymous edit of a handle LINKED to a user (403, no hijack)", async () => {
    // Pre-claim the handle for a real account.
    await memoryProfileStore.linkUser("ken", "user-abc");

    const res = await patch("ken", { displayName: "Impostor Ken" });
    expect(res.status).toBe(403);

    // The stored row is untouched — the impostor's value never landed.
    const row = await memoryProfileStore.getByHandle("ken");
    expect(row?.displayName).toBeUndefined();
  });

  it("never leaks the internal user_id on the write response", async () => {
    const res = await patch("sam", { bio: "hello" });
    const blob = JSON.stringify(await res.json());
    expect(blob).not.toMatch(/user_?id/i);
  });
});

describe("profileStore.linkUser — account migration (story 32)", () => {
  it("stamps user_id on an existing handle without touching its other fields", async () => {
    await memoryProfileStore.ensure("ken");
    await memoryProfileStore.update("ken", { displayName: "Ken" });

    const linked = await memoryProfileStore.linkUser("ken", "user-abc");
    expect(linked.userId).toBe("user-abc");
    expect(linked.displayName).toBe("Ken"); // prior activity preserved, not copied
  });

  it("is idempotent for the same user", async () => {
    await memoryProfileStore.linkUser("ken", "user-abc");
    const again = await memoryProfileStore.linkUser("ken", "user-abc");
    expect(again.userId).toBe("user-abc");
  });

  it("refuses to re-link a handle owned by a different user", async () => {
    await memoryProfileStore.linkUser("ken", "user-abc");
    await expect(memoryProfileStore.linkUser("ken", "user-xyz")).rejects.toThrow();
  });

  it("creates the row if the handle has none yet, then links it", async () => {
    const linked = await memoryProfileStore.linkUser("fresh", "user-new");
    expect(linked.handle).toBe("fresh");
    expect(linked.userId).toBe("user-new");
  });
});
