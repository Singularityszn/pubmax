// A withdrawn account's Social posts leave the saved list and the
// repost-and-quote list, as they leave the feed. A hidden-name post reaches
// the route with no handle, so the store checks its REAL author, in both the
// memory store and the durable store. A dropped row never moves a cursor.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  withdrawn: new Set<string>(),
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcRows: {} as Record<string, unknown[]>,
}));

vi.mock("@/lib/accountPublicAccess.server", () => ({
  withdrawnHandles: async (handles: readonly string[]) =>
    new Set(handles.map((handle) => handle.toLowerCase()).filter((handle) => state.withdrawn.has(handle))),
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    requiresSupabaseStore: () => true,
    requireSupabaseAdmin: () => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        state.rpcCalls.push({ name, args });
        const data = state.rpcRows[name];
        if (!data) throw new Error(`Unexpected RPC ${name}`);
        return { data, error: null };
      },
    }),
  };
});

import {
  createMemorySocialInteractionStore,
  supabaseSocialInteractionStore,
  type SocialInteractionActor,
} from "@/lib/socialInteractionStore";
import { createMemorySocialPostStore } from "@/lib/socialPostStore";
import { validateSocialPostCreate } from "@/lib/socialPosts";

const alice: SocialInteractionActor = { accountId: "account-a", profileId: "profile-a", handle: "alice" };
const bob: SocialInteractionActor = { accountId: "account-b", profileId: "profile-b", handle: "bob" };
const carol: SocialInteractionActor = { accountId: "account-c", profileId: "profile-c", handle: "carol" };
const dave: SocialInteractionActor = { accountId: "account-d", profileId: "profile-d", handle: "dave" };

beforeEach(() => {
  state.withdrawn = new Set();
  state.rpcCalls = [];
  state.rpcRows = {};
});

function fields(overrides: Record<string, unknown> = {}) {
  const result = validateSocialPostCreate({
    kind: "standard",
    visibility: "public",
    body: "Post",
    area: "camden",
    hashtags: [],
    commentPolicy: "open",
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function harness() {
  let tick = Date.parse("2026-10-18T18:00:00.000Z");
  const relationships = async () => ({
    followingProfileIds: new Set<string>(),
    mutualProfileIds: new Set<string>(),
  });
  const posts = createMemorySocialPostStore({ now: () => new Date(tick += 1_000), relationships });
  const store = createMemorySocialInteractionStore({ posts, now: () => new Date(tick += 1_000), relationships });
  const approve = { moderate: async () => ({ decision: "approved" as const }) };
  async function post(actor: SocialInteractionActor, overrides: Record<string, unknown> = {}) {
    const created = await posts.create(actor, fields(overrides));
    await posts.processModerationQueue(approve);
    return created;
  }
  async function quote(actor: SocialInteractionActor, postId: string, key: string) {
    await store.createQuote(actor, postId, { body: "Friday", visibility: "public", idempotencyKey: key });
    await store.processModerationQueue(approve);
  }
  return { store, post, quote };
}

describe("memory store: withdrawn authors leave saves and derivatives", () => {
  it.each([
    ["a named post", false],
    ["a hidden-name post", true],
  ])("drops %s whose author is withdrawn from both lists", async (_label, nameHidden) => {
    const { store, post, quote } = harness();
    const source = await post(alice, { nameHidden });
    const kept = await post(carol);
    for (const id of [source.id, kept.id]) {
      await store.setDesired(bob, id, "save", true);
      await store.setDesired(bob, id, "repost", true);
    }
    await quote(bob, source.id, "quote-source");

    expect((await store.listSaved(bob, { limit: 20 })).items).toHaveLength(2);
    expect((await store.listDerivatives(bob, { limit: 20 })).items).toHaveLength(3);

    state.withdrawn.add("alice");
    expect(await store.listSaved(bob, { limit: 20 })).toMatchObject({
      items: [{ post: { id: kept.id } }],
      nextCursor: null,
    });
    const derivatives = await store.listDerivatives(bob, { limit: 20 });
    expect(derivatives.items.map((item) => item.sourcePost.id)).toEqual([kept.id]);
    expect(derivatives.nextCursor).toBeNull();
  });

  it("drops a repost or quote whose own author is withdrawn and keeps the source post", async () => {
    const { store, post, quote } = harness();
    const source = await post(alice);
    await store.setDesired(bob, source.id, "repost", true);
    await quote(dave, source.id, "quote-dave");

    state.withdrawn.add("dave");
    expect((await store.listDerivatives(carol, { limit: 20 })).items).toEqual([
      expect.objectContaining({ kind: "repost", author: { handle: "bob" } }),
    ]);
  });

  it("pages over what is left, so a dropped save never makes a page skip", async () => {
    const { store, post } = harness();
    const kept = await post(carol);
    const withdrawn = await post(alice, { nameHidden: true });
    await store.setDesired(bob, kept.id, "save", true);
    await store.setDesired(bob, withdrawn.id, "save", true);

    state.withdrawn.add("alice");
    expect(await store.listSaved(bob, { limit: 1 })).toMatchObject({
      items: [{ post: { id: kept.id } }],
      nextCursor: null,
    });
  });
});

const sourceId = "11111111-1111-4111-8111-111111111111";
const keptId = "22222222-2222-4222-8222-222222222222";

function postRow(id: string, authorHandle: string, nameHidden: boolean, createdAt: string) {
  return {
    id,
    author_profile_id: `profile-${authorHandle}`,
    author_handle: authorHandle,
    kind: "standard",
    visibility: "public",
    status: "visible",
    body: "Source post",
    area_slug: "camden",
    venue_id: null,
    hashtags: [],
    comment_policy: "open",
    photo_media_id: null,
    photo_alt_text: null,
    moderation_state: "approved",
    revision: 0,
    mutation_version: 0,
    edited_at: null,
    moderated_at: createdAt,
    created_at: createdAt,
    updated_at: createdAt,
    author_name_hidden: nameHidden,
  };
}

function derivativeRow(id: string, authorHandle: string, source: ReturnType<typeof postRow>, createdAt: string) {
  return {
    id,
    kind: "repost",
    source_post_id: source.id,
    author_profile_id: `profile-${authorHandle}`,
    author_handle: authorHandle,
    body: null,
    visibility: "public",
    created_at: createdAt,
    source_post: source,
  };
}

describe("durable store: withdrawn authors leave saves and derivatives", () => {
  it.each([
    ["a named post", false],
    ["a hidden-name post", true],
  ])("drops %s whose author is withdrawn and keeps the cursor on the rows read", async (_label, nameHidden) => {
    const source = postRow(sourceId, "alice", nameHidden, "2026-10-18T12:00:00.000Z");
    const kept = postRow(keptId, "carol", false, "2026-10-18T11:00:00.000Z");
    state.rpcRows.read_social_saves = [
      { post_id: source.id, saved_at: "2026-10-18T14:00:00.000Z", source_post: source },
      { post_id: kept.id, saved_at: "2026-10-18T13:00:00.000Z", source_post: kept },
    ];
    state.rpcRows.read_social_derivatives = [
      derivativeRow("33333333-3333-4333-8333-333333333333", "bob", source, "2026-10-18T14:00:00.000Z"),
      derivativeRow("44444444-4444-4444-8444-444444444444", "bob", kept, "2026-10-18T13:00:00.000Z"),
    ];
    state.withdrawn.add("alice");

    // One row per page: the withdrawn row is READ and dropped, and the next
    // page still starts after it, so the kept row is neither skipped nor repeated.
    const saves = await supabaseSocialInteractionStore.listSaved(bob, { limit: 1 });
    expect(saves.items).toEqual([]);
    expect(saves.nextCursor).toEqual(expect.any(String));
    const derivatives = await supabaseSocialInteractionStore.listDerivatives(bob, { limit: 1 });
    expect(derivatives.items).toEqual([]);
    expect(derivatives.nextCursor).toEqual(expect.any(String));

    state.rpcRows.read_social_saves = state.rpcRows.read_social_saves.slice(1);
    state.rpcRows.read_social_derivatives = state.rpcRows.read_social_derivatives.slice(1);
    expect(await supabaseSocialInteractionStore.listSaved(bob, { limit: 1, cursor: saves.nextCursor }))
      .toMatchObject({ items: [{ post: { id: kept.id } }], nextCursor: null });
    expect(await supabaseSocialInteractionStore.listDerivatives(bob, { limit: 1, cursor: derivatives.nextCursor }))
      .toMatchObject({ items: [{ sourcePost: { id: kept.id } }], nextCursor: null });

    expect(state.rpcCalls.map(({ name, args }) => [name, args.p_before_created_at, args.p_limit])).toEqual([
      ["read_social_saves", null, 2],
      ["read_social_derivatives", null, 2],
      ["read_social_saves", "2026-10-18T14:00:00.000Z", 2],
      ["read_social_derivatives", "2026-10-18T14:00:00.000Z", 2],
    ]);
    expect(state.rpcCalls[2]?.args.p_before_post_id).toBe(source.id);
    expect(state.rpcCalls[3]?.args.p_before_id).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("drops a repost whose own author is withdrawn and keeps the source post", async () => {
    const source = postRow(sourceId, "alice", false, "2026-10-18T12:00:00.000Z");
    state.rpcRows.read_social_derivatives = [
      derivativeRow("33333333-3333-4333-8333-333333333333", "dave", source, "2026-10-18T14:00:00.000Z"),
      derivativeRow("44444444-4444-4444-8444-444444444444", "bob", source, "2026-10-18T13:00:00.000Z"),
    ];
    state.withdrawn.add("dave");

    expect(await supabaseSocialInteractionStore.listDerivatives(carol, { limit: 20 })).toEqual({
      items: [expect.objectContaining({ id: "44444444-4444-4444-8444-444444444444", author: { handle: "bob" } })],
      nextCursor: null,
    });
  });

  it("never hands the hidden author's handle to the reader, in a row or in a cursor", async () => {
    const source = postRow(sourceId, "alice", true, "2026-10-18T12:00:00.000Z");
    const older = postRow(keptId, "alice", true, "2026-10-18T11:00:00.000Z");
    state.rpcRows.read_social_saves = [
      { post_id: source.id, saved_at: "2026-10-18T14:00:00.000Z", source_post: source },
      { post_id: older.id, saved_at: "2026-10-18T13:00:00.000Z", source_post: older },
    ];
    state.rpcRows.read_social_derivatives = [
      derivativeRow("33333333-3333-4333-8333-333333333333", "bob", source, "2026-10-18T14:00:00.000Z"),
      derivativeRow("44444444-4444-4444-8444-444444444444", "bob", older, "2026-10-18T13:00:00.000Z"),
    ];

    const saves = await supabaseSocialInteractionStore.listSaved(carol, { limit: 1 });
    const derivatives = await supabaseSocialInteractionStore.listDerivatives(carol, { limit: 1 });
    expect(saves.items).toMatchObject([{ post: { id: source.id, author: { handle: null } } }]);
    expect(derivatives.items).toMatchObject([{ sourcePost: { id: source.id, author: { handle: null } } }]);
    for (const page of [saves, derivatives]) {
      const [encoded = ""] = String(page.nextCursor).split(".");
      expect(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))).toEqual({
        v: 1,
        createdAt: "2026-10-18T14:00:00.000Z",
        id: page === saves ? source.id : "33333333-3333-4333-8333-333333333333",
      });
      expect(JSON.stringify(page.items)).not.toContain("alice");
    }
  });
});
