import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

// Round 4: the author's own tag checks read the ACCOUNT, never the handle
// text, so a rename on either side keeps both checks true; and a diary
// entry's tags can be changed after it was saved through the one consent path.
//
// The ownership seam is the REAL one (review P2, PR 2402): the production
// `ownsHandle` over the memory identity handle store and profile store, which
// match the verified AUTH user id against `profiles.user_id`. Each account
// also has a private Social account record id of its own, as provisioning
// gives it, and that id never passes for the author.

import { __resetMemoryIdentityHandles, identityHandleStore } from "@/lib/identityHandleStore";
import {
  __resetMemoryWithTags,
  createPintDropWithTagsStore,
  defaultWithTagDependencies,
  memoryWithTagRows,
  type WithTagActor,
  type WithTagDependencies,
  type WithTagDiaryEntry,
  type WithTagDrop,
} from "@/lib/pintDropWithTagsStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

const DROP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENTRY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ENTRY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Account = { authUserId: string; socialAccountId: string; profileId: string };

// Profile id -> current handle, for the printed names only. Who holds which
// handle is read through the real ownership seam.
let handles: Map<string, string>;
let drops: Map<string, WithTagDrop>;
let entries: Map<string, WithTagDiaryEntry>;
let idCounter = 0;
let alice: Account;
let sam: Account;
let priya: Account;

async function provision(handle: string): Promise<Account> {
  const authUserId = randomUUID();
  const claimed = await identityHandleStore().claim(authUserId, handle);
  if (!claimed.ok) throw new Error(`claim failed for ${handle}`);
  handles.set(claimed.profileId, handle);
  return { authUserId, socialAccountId: randomUUID(), profileId: claimed.profileId };
}

function actor(account: Account): WithTagActor {
  return { profileId: account.profileId, accountId: account.authUserId, handle: handles.get(account.profileId) ?? "" };
}

async function rename(account: Account, next: string) {
  const renamed = await identityHandleStore().rename(account.authUserId, next);
  if (!renamed.ok) throw new Error(`rename failed for ${next}`);
  handles.set(account.profileId, next);
}

function deps(): WithTagDependencies {
  return {
    rows: memoryWithTagRows,
    drop: async (id) => drops.get(id) ?? null,
    diaryEntry: async (id) => entries.get(id) ?? null,
    currentHandles: async (ids) => new Map(ids.flatMap((id) => (handles.has(id) ? [[id, handles.get(id)!]] : []))),
    claimedProfile: async (handle) => {
      for (const [id, current] of handles) if (current === handle) return { id, handle: current };
      return null;
    },
    blocked: async () => false,
    publicDropIds: async (ids) => ids.filter((id) => drops.get(id)?.visibility === "public"),
    hiddenHandles: async () => new Set<string>(),
    venueName: async () => "The Seven Stars",
    ownsHandle: defaultWithTagDependencies(memoryWithTagRows).ownsHandle,
    now: () => new Date(Date.UTC(2026, 9, 30, 21, 0, idCounter)),
    newId: () => {
      idCounter += 1;
      return `0000000${idCounter}`.slice(-8) + "-0000-4000-8000-000000000000";
    },
  };
}

beforeEach(async () => {
  __resetMemoryWithTags();
  __resetMemoryIdentityHandles();
  __resetMemoryProfiles();
  handles = new Map();
  alice = await provision("alice");
  sam = await provision("sam");
  priya = await provision("priya");
  // A mutuals-only drop, so only its author reads its tags.
  drops = new Map([[DROP, { handle: "alice", visibility: "friends", status: "visible", venueId: "venue-1" }]]);
  entries = new Map([
    [ENTRY, { ownerUserId: alice.authUserId, venueId: "venue-2", venueName: "The Dove" }],
    [OTHER_ENTRY, { ownerUserId: alice.authUserId, venueId: "venue-3", venueName: "The Lamb" }],
  ]);
  idCounter = 0;
});

describe("a rename keeps the author's own tag checks true", () => {
  it("renames the author and the tagged account, and both checks still hold", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.propose(actor(alice), DROP, ["sam"]);

    // Both accounts rename. The drop still carries the handle it was posted under.
    await rename(alice, "alice_new");
    await rename(sam, "sam_new");
    const aliceNow = actor(alice);
    const samNow = actor(sam);

    // Check one: the author may still tag on her own drop.
    await expect(store.propose(aliceNow, DROP, ["priya"])).resolves.toBeUndefined();

    // The tagged account still decides its own tag, by profile id.
    const inbox = await store.inbox(samNow, { lane: "proposed", limit: 10 });
    expect(inbox.proposals).toHaveLength(1);
    expect(inbox.proposals[0]!.taggerHandle).toBe("alice_new");
    await store.act(samNow, inbox.proposals[0]!.id, "approve");

    // Check two: the author still reads her own non-public drop's tags, under
    // the tagged person's CURRENT handle.
    const summary = (await store.summaries([DROP], aliceNow)).get(DROP);
    expect(summary).toEqual({ approved: ["sam_new"], pending: 1 });
  });

  it("does not let somebody who now holds no handle of the drop act as its author", async () => {
    const store = createPintDropWithTagsStore(deps());
    // Priya typing her way to the old text proves nothing: her account never held it.
    const impostor = { profileId: priya.profileId, accountId: priya.authUserId, handle: "alice" };
    await expect(store.propose(impostor, DROP, ["sam"])).rejects.toMatchObject({ kind: "not_owner" });
    expect((await store.summaries([DROP], impostor)).size).toBe(0);
  });

  it("never reads the Social account record id as the auth owner", async () => {
    const store = createPintDropWithTagsStore(deps());
    const wrongDomain = { ...actor(alice), accountId: alice.socialAccountId };
    await expect(store.propose(wrongDomain, DROP, ["sam"])).rejects.toMatchObject({ kind: "not_owner" });
  });
});

describe("editing a diary entry's tags after it was saved", () => {
  it("asks a newly added handle first and takes a removed one off", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.proposeOnDiary(actor(alice), ENTRY, ["sam"]);
    const [samTag] = (await store.diaryTagList(alice.authUserId, [ENTRY])).get(ENTRY)!;
    expect(samTag).toMatchObject({ handle: "sam", state: "proposed" });

    await store.editDiaryTags(actor(alice), ENTRY, { add: ["priya"], remove: [samTag!.id] });

    // Priya has the consent item; Sam's proposal has left his inbox.
    const priyaInbox = await store.inbox(actor(priya), { lane: "proposed", limit: 10 });
    expect(priyaInbox.proposals.map((item) => item.subject)).toEqual(["diary"]);
    expect((await store.inbox(actor(sam), { lane: "proposed", limit: 10 })).proposals).toEqual([]);
    expect((await store.diarySummaries(alice.authUserId, [ENTRY])).get(ENTRY)).toEqual({ approved: [], pending: 1 });
  });

  it("withdraws an approved tag the owner takes off, so the handle stops printing", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.proposeOnDiary(actor(alice), ENTRY, ["sam"]);
    const [item] = (await store.inbox(actor(sam), { lane: "proposed", limit: 10 })).proposals;
    await store.act(actor(sam), item!.id, "approve");
    expect((await store.diarySummaries(alice.authUserId, [ENTRY])).get(ENTRY)).toEqual({ approved: ["sam"], pending: 0 });

    await store.editDiaryTags(actor(alice), ENTRY, { add: [], remove: [item!.id] });
    expect((await store.diarySummaries(alice.authUserId, [ENTRY])).get(ENTRY)).toBeUndefined();
    expect((await store.inbox(actor(sam), { lane: "approved", limit: 10 })).proposals).toEqual([]);
  });

  it("asks again after the owner's own untag, and never after the person said no", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.proposeOnDiary(actor(alice), ENTRY, ["sam", "priya"]);
    const list = (await store.diaryTagList(alice.authUserId, [ENTRY])).get(ENTRY)!;
    const samTag = list.find((tag) => tag.handle === "sam")!;
    await store.editDiaryTags(actor(alice), ENTRY, { add: [], remove: [samTag.id] });
    const [priyaItem] = (await store.inbox(actor(priya), { lane: "proposed", limit: 10 })).proposals;
    await store.act(actor(priya), priyaItem!.id, "decline");

    await store.editDiaryTags(actor(alice), ENTRY, { add: ["sam", "priya"], remove: [] });
    expect((await store.inbox(actor(sam), { lane: "proposed", limit: 10 })).proposals).toHaveLength(1);
    expect((await store.inbox(actor(priya), { lane: "proposed", limit: 10 })).proposals).toEqual([]);
  });

  it("refuses an entry the actor does not own, and leaves another entry's tag alone", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.proposeOnDiary(actor(alice), OTHER_ENTRY, ["sam"]);
    const [otherTag] = (await store.diaryTagList(alice.authUserId, [OTHER_ENTRY])).get(OTHER_ENTRY)!;

    await expect(
      store.editDiaryTags(actor(sam), ENTRY, { add: ["priya"], remove: [] }),
    ).rejects.toMatchObject({ kind: "not_owner" });

    await store.editDiaryTags(actor(alice), ENTRY, { add: [], remove: [otherTag!.id] });
    expect((await store.diaryTagList(alice.authUserId, [OTHER_ENTRY])).get(OTHER_ENTRY)).toHaveLength(1);
    // Nobody else reads the owner's list.
    expect((await store.diaryTagList(sam.authUserId, [OTHER_ENTRY])).size).toBe(0);
  });
});
