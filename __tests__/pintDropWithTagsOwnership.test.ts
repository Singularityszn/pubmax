import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Review P2 on PR 2402. A Pint Drop's "With" tags are the author's to ask and
// to read, and authorship is decided through the REAL ownership seam
// (`identityHandleStore().ownedHandle`), which matches the verified AUTH user
// id against `profiles.user_id`. The Social session's actor carries the
// private Social account record's id instead, and provisioning gives that
// record a UUID of its own. This file gives the two domains distinct ids, as
// provisioning does, and keeps every store on the ownership path real: the
// identity handle store, the profile store and the tag rows are the memory
// backends. Only the Supabase session check is replaced, by the real
// resolver fed a verified user id and the account record it would read.

const session = vi.hoisted(() => ({
  // Verified auth user id -> the private Social account record id.
  socialAccountFor: new Map<string, string>(),
}));

vi.mock("@/lib/socialAccessServer", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/socialAccessServer")>();
  const { profileStore } = await import("@/lib/profileStore");
  const dependencies: import("@/lib/socialAccessServer").SocialAccessServerDependencies = {
    friendsLaunchEnabled: true,
    now: () => new Date(Date.UTC(2026, 9, 30, 21, 0, 0)),
    verifySupabaseSession: async (request?: Request) => {
      const userId = request?.headers.get("x-test-auth-user") ?? "";
      return userId ? { status: "verified", userId } : { status: "absent" };
    },
    readFriendsLaunchAccess: async (userId: string) => {
      const profile = await profileStore().getByUserId(userId);
      const accountId = session.socialAccountFor.get(userId);
      return {
        account: accountId ? { id: accountId, ownershipState: "active" } : null,
        profile: profile ? { id: profile.id, handle: profile.handle } : null,
        dateOfBirth: "1990-01-01",
      };
    },
  };
  return {
    ...real,
    requireVerifiedSocialActor: (request?: Request) => real.requireVerifiedSocialActor(request, dependencies),
  };
});

import { GET as summaries, POST as propose } from "@/app/api/social/tags/with/route";
import { __resetMemoryIdentityHandles, identityHandleStore } from "@/lib/identityHandleStore";
import { __resetPintDrops, addPintDrop } from "@/lib/pintDrops";
import { __resetMemoryWithTags, memoryWithTagRows } from "@/lib/pintDropWithTagsStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

const DROP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Account = { authUserId: string; socialAccountId: string; profileId: string; handle: string };

// Sign-up claims a handle under the auth user id; Social provisioning then
// writes a private account record with an id of its own.
async function provision(handle: string): Promise<Account> {
  const authUserId = randomUUID();
  const claimed = await identityHandleStore().claim(authUserId, handle);
  if (!claimed.ok) throw new Error(`claim failed for ${handle}`);
  const socialAccountId = randomUUID();
  session.socialAccountFor.set(authUserId, socialAccountId);
  return { authUserId, socialAccountId, profileId: claimed.profileId, handle };
}

function asAccount(account: Account, init: RequestInit & { url?: string } = {}): Request {
  const { url = "http://localhost/api/social/tags/with", ...rest } = init;
  return new Request(url, {
    ...rest,
    headers: { "Content-Type": "application/json", "x-test-auth-user": account.authUserId },
  });
}

function proposeAs(account: Account, handles: string[]): Promise<Response> {
  return propose(asAccount(account, { method: "POST", body: JSON.stringify({ dropId: DROP, handles }) }));
}

async function summaryAs(account: Account): Promise<Record<string, unknown>> {
  const response = await summaries(asAccount(account, { url: `http://localhost/api/social/tags/with?drops=${DROP}` }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { drops: Record<string, unknown> }).drops;
}

let alice: Account;
let sam: Account;
let priya: Account;

beforeEach(async () => {
  __resetMemoryIdentityHandles();
  __resetMemoryProfiles();
  __resetMemoryWithTags();
  __resetPintDrops();
  session.socialAccountFor.clear();
  alice = await provision("alice");
  sam = await provision("sam");
  priya = await provision("priya");
  // A mutuals-only drop, so only its author may read its tags.
  addPintDrop({
    id: DROP,
    venueId: "venue-1",
    handle: "alice",
    drink: "Bitter",
    priceGbp: 5.2,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "friends",
    createdAt: new Date(Date.UTC(2026, 9, 30, 20, 0, 0)).toISOString(),
  });
});

describe("With tag ownership binds to the verified auth owner", () => {
  it("gives the two account domains distinct ids, as provisioning does", () => {
    expect(alice.authUserId).not.toBe(alice.socialAccountId);
  });

  it("lets the author propose a With tag through the route", async () => {
    const response = await proposeAs(alice, ["sam"]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    const pending = await memoryWithTagRows.listForTarget(sam.profileId, "proposed", null, 10);
    expect(pending.map((row) => row.dropId)).toEqual([DROP]);
  });

  it("lets the author read the tags on her own non-public drop", async () => {
    await memoryWithTagRows.insertIfAbsent({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      dropId: DROP,
      diaryEntryId: null,
      taggerProfileId: alice.profileId,
      taggerHandle: "alice",
      targetProfileId: sam.profileId,
      targetHandle: "sam",
      state: "proposed",
      createdAt: new Date(Date.UTC(2026, 9, 30, 20, 30, 0)).toISOString(),
      decidedAt: null,
    });
    expect(await summaryAs(alice)).toEqual({ [DROP]: { approved: [], pending: 1 } });
    // Anybody else reads nothing from a mutuals-only drop.
    expect(await summaryAs(priya)).toEqual({});
  });

  it("keeps the author's checks true after she renames", async () => {
    const renamed = await identityHandleStore().rename(alice.authUserId, "alice_new");
    expect(renamed.ok).toBe(true);
    const response = await proposeAs(alice, ["sam"]);
    expect(response.status).toBe(200);
    expect(await summaryAs(alice)).toEqual({ [DROP]: { approved: [], pending: 1 } });
  });

  it("refuses an account that never held the drop's handle", async () => {
    const response = await proposeAs(priya, ["sam"]);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "TAG_ACTION_DENIED" });
  });
});
