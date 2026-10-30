import { beforeEach, describe, expect, it } from "vitest";

// Round 4: the author's own tag checks read the ACCOUNT, never the handle
// text, so a rename on either side keeps both checks true; and a diary
// entry's tags can be changed after it was saved through the one consent path.

import {
  __resetMemoryWithTags,
  createPintDropWithTagsStore,
  memoryWithTagRows,
  type WithTagActor,
  type WithTagDependencies,
  type WithTagDiaryEntry,
  type WithTagDrop,
} from "@/lib/pintDropWithTagsStore";

const DROP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENTRY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ENTRY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ALICE_ID = "11111111-1111-4111-8111-111111111111";
const SAM_ID = "22222222-2222-4222-8222-222222222222";
const PRIYA_ID = "33333333-3333-4333-8333-333333333333";

// Profile id -> current handle; account id -> every handle it ever held.
let handles: Map<string, string>;
let heldBy: Map<string, Set<string>>;
let drops: Map<string, WithTagDrop>;
let entries: Map<string, WithTagDiaryEntry>;
let idCounter = 0;

function actor(profileId: string, accountId: string): WithTagActor {
  return { profileId, accountId, handle: handles.get(profileId) ?? "" };
}

function rename(profileId: string, accountId: string, next: string) {
  handles.set(profileId, next);
  heldBy.get(accountId)!.add(next);
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
    ownsHandle: async (accountId, handle) => heldBy.get(accountId)?.has(handle) ?? false,
    now: () => new Date(Date.UTC(2026, 9, 30, 21, 0, idCounter)),
    newId: () => {
      idCounter += 1;
      return `0000000${idCounter}`.slice(-8) + "-0000-4000-8000-000000000000";
    },
  };
}

beforeEach(() => {
  __resetMemoryWithTags();
  handles = new Map([
    [ALICE_ID, "alice"],
    [SAM_ID, "sam"],
    [PRIYA_ID, "priya"],
  ]);
  heldBy = new Map([
    ["acct-alice", new Set(["alice"])],
    ["acct-sam", new Set(["sam"])],
    ["acct-priya", new Set(["priya"])],
  ]);
  // A mutuals-only drop, so only its author reads its tags.
  drops = new Map([[DROP, { handle: "alice", visibility: "friends", status: "visible", venueId: "venue-1" }]]);
  entries = new Map([
    [ENTRY, { ownerUserId: "acct-alice", venueId: "venue-2", venueName: "The Dove" }],
    [OTHER_ENTRY, { ownerUserId: "acct-alice", venueId: "venue-3", venueName: "The Lamb" }],
  ]);
  idCounter = 0;
});

describe("a rename keeps the author's own tag checks true", () => {
  it("renames the author and the tagged account, and both checks still hold", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.propose(actor(ALICE_ID, "acct-alice"), DROP, ["sam"]);

    // Both accounts rename. The drop still carries the handle it was posted under.
    rename(ALICE_ID, "acct-alice", "alice_new");
    rename(SAM_ID, "acct-sam", "sam_new");
    const alice = actor(ALICE_ID, "acct-alice");
    const sam = actor(SAM_ID, "acct-sam");

    // Check one: the author may still tag on her own drop.
    await expect(store.propose(alice, DROP, ["priya"])).resolves.toBeUndefined();

    // The tagged account still decides its own tag, by profile id.
    const inbox = await store.inbox(sam, { lane: "proposed", limit: 10 });
    expect(inbox.proposals).toHaveLength(1);
    expect(inbox.proposals[0]!.taggerHandle).toBe("alice_new");
    await store.act(sam, inbox.proposals[0]!.id, "approve");

    // Check two: the author still reads her own non-public drop's tags, under
    // the tagged person's CURRENT handle.
    const summary = (await store.summaries([DROP], alice)).get(DROP);
    expect(summary).toEqual({ approved: ["sam_new"], pending: 1 });
  });

  it("does not let somebody who now holds no handle of the drop act as its author", async () => {
    const store = createPintDropWithTagsStore(deps());
    // Priya typing her way to the old text proves nothing: her account never held it.
    const impostor = { profileId: PRIYA_ID, accountId: "acct-priya", handle: "alice" };
    await expect(store.propose(impostor, DROP, ["sam"])).rejects.toMatchObject({ kind: "not_owner" });
    expect((await store.summaries([DROP], impostor)).size).toBe(0);
  });
});

describe("editing a diary entry's tags after it was saved", () => {
  it("asks a newly added handle first and takes a removed one off", async () => {
    const store = createPintDropWithTagsStore(deps());
    const alice = actor(ALICE_ID, "acct-alice");
    await store.proposeOnDiary(alice, ENTRY, ["sam"]);
    const [samTag] = (await store.diaryTagList("acct-alice", [ENTRY])).get(ENTRY)!;
    expect(samTag).toMatchObject({ handle: "sam", state: "proposed" });

    await store.editDiaryTags(alice, ENTRY, { add: ["priya"], remove: [samTag!.id] });

    // Priya has the consent item; Sam's proposal has left his inbox.
    const priyaInbox = await store.inbox(actor(PRIYA_ID, "acct-priya"), { lane: "proposed", limit: 10 });
    expect(priyaInbox.proposals.map((item) => item.subject)).toEqual(["diary"]);
    expect((await store.inbox(actor(SAM_ID, "acct-sam"), { lane: "proposed", limit: 10 })).proposals).toEqual([]);
    expect((await store.diarySummaries("acct-alice", [ENTRY])).get(ENTRY)).toEqual({ approved: [], pending: 1 });
  });

  it("withdraws an approved tag the owner takes off, so the handle stops printing", async () => {
    const store = createPintDropWithTagsStore(deps());
    const alice = actor(ALICE_ID, "acct-alice");
    const sam = actor(SAM_ID, "acct-sam");
    await store.proposeOnDiary(alice, ENTRY, ["sam"]);
    const [item] = (await store.inbox(sam, { lane: "proposed", limit: 10 })).proposals;
    await store.act(sam, item!.id, "approve");
    expect((await store.diarySummaries("acct-alice", [ENTRY])).get(ENTRY)).toEqual({ approved: ["sam"], pending: 0 });

    await store.editDiaryTags(alice, ENTRY, { add: [], remove: [item!.id] });
    expect((await store.diarySummaries("acct-alice", [ENTRY])).get(ENTRY)).toBeUndefined();
    expect((await store.inbox(sam, { lane: "approved", limit: 10 })).proposals).toEqual([]);
  });

  it("asks again after the owner's own untag, and never after the person said no", async () => {
    const store = createPintDropWithTagsStore(deps());
    const alice = actor(ALICE_ID, "acct-alice");
    const sam = actor(SAM_ID, "acct-sam");
    const priya = actor(PRIYA_ID, "acct-priya");
    await store.proposeOnDiary(alice, ENTRY, ["sam", "priya"]);
    const list = (await store.diaryTagList("acct-alice", [ENTRY])).get(ENTRY)!;
    const samTag = list.find((tag) => tag.handle === "sam")!;
    await store.editDiaryTags(alice, ENTRY, { add: [], remove: [samTag.id] });
    const [priyaItem] = (await store.inbox(priya, { lane: "proposed", limit: 10 })).proposals;
    await store.act(priya, priyaItem!.id, "decline");

    await store.editDiaryTags(alice, ENTRY, { add: ["sam", "priya"], remove: [] });
    expect((await store.inbox(sam, { lane: "proposed", limit: 10 })).proposals).toHaveLength(1);
    expect((await store.inbox(priya, { lane: "proposed", limit: 10 })).proposals).toEqual([]);
  });

  it("refuses an entry the actor does not own, and leaves another entry's tag alone", async () => {
    const store = createPintDropWithTagsStore(deps());
    const alice = actor(ALICE_ID, "acct-alice");
    await store.proposeOnDiary(alice, OTHER_ENTRY, ["sam"]);
    const [otherTag] = (await store.diaryTagList("acct-alice", [OTHER_ENTRY])).get(OTHER_ENTRY)!;

    await expect(
      store.editDiaryTags(actor(SAM_ID, "acct-sam"), ENTRY, { add: ["priya"], remove: [] }),
    ).rejects.toMatchObject({ kind: "not_owner" });

    await store.editDiaryTags(alice, ENTRY, { add: [], remove: [otherTag!.id] });
    expect((await store.diaryTagList("acct-alice", [OTHER_ENTRY])).get(OTHER_ENTRY)).toHaveLength(1);
    // Nobody else reads the owner's list.
    expect((await store.diaryTagList("acct-sam", [OTHER_ENTRY])).size).toBe(0);
  });
});
