// "Tell your lot": a diary log or a ranking writes ONE mutuals-only Social post
// when, and only when, the request says shareToLot: true, in the name of the
// session's own verified Social account. Without it nothing is posted. The
// post is an ordinary post: friends visibility, the venue, pending moderation,
// and its author can delete it. "Your usual here" round-trips on the diary.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const state = vi.hoisted(() => ({
  identity: { ok: true as const, accountId: "acct-alice", actor: "profile:alice", handle: "alice" },
  social: {
    ok: true as const,
    actor: { accountId: "acct-alice", profileId: "social-alice", handle: "alice" },
  } as { ok: true; actor: { accountId: string; profileId: string; handle: string } } | { ok: false; status: number; code: string; error: string },
}));

vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () => state.identity,
}));
vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => state.social,
}));
vi.mock("@/lib/opsFreeze", () => ({ socialFreezeResponse: () => null }));

import { POST as diaryPost, GET as diaryGet } from "@/app/api/diary/route";
import { POST as rankingsPost } from "@/app/api/social/rankings/route";
import { __resetDiary } from "@/lib/diaryStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { socialPostStore } from "@/lib/socialPostStore";
import { getVenueIndex } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

let PUBS: Array<{ id: string; name: string }> = [];
let run = 0;

beforeAll(async () => {
  const index = await getVenueIndex();
  PUBS = [...index.values()].filter((venue) => isPubVenueKind(venue.kind)).slice(0, 4)
    .map((venue) => ({ id: venue.id, name: venue.name }));
  if (PUBS.length < 4) throw new Error("venue index is empty");
});

/** A fresh account per case, so the shared in-memory post store never leaks between cases. */
function signIn(name: string) {
  run += 1;
  // A provisioned account: the auth user id owns the diary, the Social record
  // has its own id, and both verify the same profile (review finding 6).
  const account = `acct-${name}-${run}`;
  state.identity = { ok: true, accountId: account, actor: `profile:social-${name}-${run}`, handle: name };
  state.social = { ok: true, actor: { accountId: `psa-${name}-${run}`, profileId: `social-${name}-${run}`, handle: name } };
  return state.social.actor;
}

function request(url: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${run}` },
    body: JSON.stringify(body),
  });
}

async function postsOf(actor: { accountId: string; profileId: string; handle: string }) {
  return socialPostStore().listOwned(actor, 20);
}

beforeEach(() => {
  __resetDiary();
  __resetPintDrops();
});

describe("POST /api/diary with Tell your lot", () => {
  it("writes no post without shareToLot", async () => {
    const actor = signIn("sam");
    const res = await diaryPost(request("/api/diary", { venueId: PUBS[0]!.id }));
    expect(res.status).toBe(201);
    expect((await res.json()).shared).toBe(false);
    expect(await postsOf(actor)).toHaveLength(0);
  });

  it("writes exactly one friends post, with the venue, pending moderation, that its author can delete", async () => {
    const actor = signIn("sam");
    const res = await diaryPost(request("/api/diary", { venueId: PUBS[0]!.id, review: "Lovely fire.", shareToLot: true }));
    expect(res.status).toBe(201);
    expect((await res.json()).shared).toBe(true);
    const posts = await postsOf(actor);
    expect(posts).toHaveLength(1);
    const [post] = posts;
    expect(post).toMatchObject({
      visibility: "friends",
      venueId: PUBS[0]!.id,
      moderationState: "pending",
      body: `@sam was at ${PUBS[0]!.name}`,
    });
    // The private review never leaves the diary.
    expect(post!.body).not.toContain("fire");
    expect(await socialPostStore().remove(post!.id, actor, post!.mutationVersion, `rm-${run}`)).toBe(true);
    expect(await postsOf(actor)).toHaveLength(0);
  });

  it("refuses a shareToLot that is not a yes or a no", async () => {
    signIn("sam");
    const res = await diaryPost(request("/api/diary", { venueId: PUBS[0]!.id, shareToLot: "yes" }));
    expect(res.status).toBe(400);
  });

  it("never posts for someone else: a body handle is ignored and a Social account of another owner posts nothing", async () => {
    const alice = signIn("alice");
    const aliceOwner = state.identity.accountId;
    const bob = { accountId: "acct-bob-x", profileId: "social-bob-x", handle: "bob" };
    // The session's Social account belongs to Bob; the diary belongs to Alice.
    state.social = { ok: true, actor: bob };
    const res = await diaryPost(request("/api/diary", {
      venueId: PUBS[1]!.id,
      shareToLot: true,
      handle: "bob",
      ownerUserId: "acct-bob-x",
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.shared).toBe(false);
    expect(body.entry.ownerUserId).toBe(aliceOwner);
    expect(await postsOf(bob)).toHaveLength(0);
    expect(await postsOf(alice)).toHaveLength(0);
  });

  // Review finding 6 (PR 2402): provisioning gives the Social account record
  // its own UUID, apart from the auth user id the diary is owned by. The two
  // are never equal for a real account, so ownership is read in one domain:
  // the profile both sides verified.
  it("shares for a provisioned account whose Social record id is not its auth user id", async () => {
    run += 1;
    const authUserId = `0b0e2a1c-0000-4000-8000-00000000${String(run).padStart(4, "0")}`;
    const profileId = `prof-pat-${run}`;
    state.identity = { ok: true, accountId: authUserId, actor: `profile:${profileId}`, handle: "pat" };
    const actor = { accountId: `psa-${run}-distinct-uuid`, profileId, handle: "pat" };
    state.social = { ok: true, actor };
    const res = await diaryPost(request("/api/diary", { venueId: PUBS[2]!.id, shareToLot: true }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.entry.ownerUserId).toBe(authUserId);
    expect(body.shared).toBe(true);
    expect(await postsOf(actor)).toHaveLength(1);
  });

  it("still refuses a Social session whose profile is not the diary owner's, even when the account ids match", async () => {
    const alice = signIn("alice");
    state.social = { ok: true, actor: { accountId: state.identity.accountId, profileId: "prof-mallory", handle: "mallory" } };
    const res = await diaryPost(request("/api/diary", { venueId: PUBS[3]!.id, shareToLot: true }));
    expect(res.status).toBe(201);
    expect((await res.json()).shared).toBe(false);
    expect(await postsOf(alice)).toHaveLength(0);
  });

  it("keeps the log private when Social refuses the session", async () => {
    const actor = signIn("sam");
    state.social = { ok: false, status: 403, code: "SOCIAL_ADULT_VERIFICATION_REQUIRED", error: "Adult verification is needed for Social." };
    const res = await diaryPost(request("/api/diary", { venueId: PUBS[0]!.id, shareToLot: true }));
    expect(res.status).toBe(201);
    expect((await res.json()).shared).toBe(false);
    expect(await postsOf(actor)).toHaveLength(0);
  });
});

describe("Your usual here", () => {
  it("round-trips on the owner's diary and is refused past 40 characters", async () => {
    signIn("sam");
    const created = await diaryPost(request("/api/diary", { venueId: PUBS[0]!.id, usualDrink: "  Harvey's   Best\n" }));
    expect(created.status).toBe(201);
    const entry = (await created.json()).entry;
    expect(entry.usualDrink).toBe("Harvey's Best");

    const list = await (await diaryGet(new Request("http://localhost/api/diary"))).json();
    expect(list.entries[0].usualDrink).toBe("Harvey's Best");

    const changed = await diaryPost(request("/api/diary", { action: "update", id: entry.id, usualDrink: "Guinness" }));
    expect((await changed.json()).entry.usualDrink).toBe("Guinness");

    const tooLong = await diaryPost(request("/api/diary", { venueId: PUBS[1]!.id, usualDrink: "x".repeat(41) }));
    expect(tooLong.status).toBe(400);
  });
});

describe("POST /api/social/rankings with Tell your lot", () => {
  it("writes no post without shareToLot", async () => {
    const actor = signIn("sam");
    const res = await rankingsPost(request("/api/social/rankings", { venueId: PUBS[0]!.id, band: "loved", aboveVenueId: null, belowVenueId: null }));
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty("shared");
    expect(await postsOf(actor)).toHaveLength(0);
  });

  it("writes one friends post naming the pub just below", async () => {
    const actor = signIn("sam");
    await rankingsPost(request("/api/social/rankings", { venueId: PUBS[1]!.id, band: "loved", aboveVenueId: null, belowVenueId: null }));
    const res = await rankingsPost(request("/api/social/rankings", {
      venueId: PUBS[2]!.id, band: "loved", aboveVenueId: null, belowVenueId: PUBS[1]!.id, shareToLot: true,
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).shared).toBe(true);
    const posts = await postsOf(actor);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      visibility: "friends",
      venueId: PUBS[2]!.id,
      moderationState: "pending",
      body: `@sam ranked ${PUBS[2]!.name} above ${PUBS[1]!.name}`,
    });
  });

  it("refuses a body that tries to name another author", async () => {
    const actor = signIn("sam");
    const res = await rankingsPost(request("/api/social/rankings", {
      venueId: PUBS[3]!.id, band: "fine", aboveVenueId: null, belowVenueId: null, shareToLot: true, handle: "bob",
    }));
    expect(res.status).toBe(400);
    expect(await postsOf(actor)).toHaveLength(0);
  });
});
