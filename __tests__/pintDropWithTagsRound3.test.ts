import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Round 3 of "With" tags (WEEK1_HYGIENE_BUILD section 4): the line on the drop
// card from one batched read, tags that ride a retried save without ever
// doubling, a tag that follows its account through a rename, and the same
// consented tags on a diary entry.

const fetchState = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; body: unknown }>,
  statuses: [] as number[],
}));

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: async (url: string, init: RequestInit) => {
    fetchState.calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    const status = fetchState.statuses.shift() ?? 200;
    return new Response(JSON.stringify({ ok: status < 400 }), { status });
  },
  authedFetch: async (url: string) => {
    fetchState.calls.push({ url, body: null });
    return new Response(JSON.stringify({ drops: {} }), { status: 200 });
  },
}));

import PintDropsList from "@/components/map/inspector/PintDropsList";
import { __resetSentWithTags, proposeWithTags } from "@/components/map/composer/proposeWithTags";
import { fetchWithSummaries, withSummaryIds } from "@/components/map/composer/useWithSummaries";
import type { DropWithPhotos } from "@/components/map/usePintDrops";
import {
  buildOptimisticSpillRetryPayload,
  readOptimisticSpills,
  upsertOptimisticSpill,
  writeOptimisticSpills,
  buildOptimisticSpillDrop,
} from "@/lib/optimisticSpillPost";
import {
  __resetMemoryWithTags,
  createPintDropWithTagsStore,
  memoryWithTagRows,
  type WithTagActor,
  type WithTagDependencies,
  type WithTagDiaryEntry,
  type WithTagDrop,
} from "@/lib/pintDropWithTagsStore";
import type { Venue } from "@/lib/venues";

const DROP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DROP_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ENTRY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ALICE: WithTagActor = { profileId: "11111111-1111-4111-8111-111111111111", handle: "alice", accountId: "acct-alice" };
const SAM: WithTagActor = { profileId: "22222222-2222-4222-8222-222222222222", handle: "sam", accountId: "acct-sam" };
const PRIYA: WithTagActor = { profileId: "33333333-3333-4333-8333-333333333333", handle: "priya", accountId: "acct-priya" };

let handles: Map<string, string>;
let blocks: Set<string>;
let drops: Map<string, WithTagDrop>;
let entries: Map<string, WithTagDiaryEntry>;
let idCounter = 0;

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
    blocked: async (first, second) => blocks.has(`${first}:${second}`) || blocks.has(`${second}:${first}`),
    publicDropIds: async (ids) => ids.filter((id) => drops.get(id)?.visibility === "public"),
    hiddenHandles: async () => new Set<string>(),
    venueName: async () => "The Seven Stars",
    now: () => new Date(Date.UTC(2026, 9, 30, 20, 0, idCounter)),
    newId: () => {
      idCounter += 1;
      return `0000000${idCounter}`.slice(-8) + "-0000-4000-8000-000000000000";
    },
  };
}

beforeEach(() => {
  __resetMemoryWithTags();
  __resetSentWithTags();
  fetchState.calls = [];
  fetchState.statuses = [];
  handles = new Map([ALICE, SAM, PRIYA].map((actor) => [actor.profileId, actor.handle]));
  blocks = new Set();
  drops = new Map([[DROP, { handle: "alice", visibility: "public", status: "visible", venueId: "venue-1" }]]);
  entries = new Map([[ENTRY, { ownerUserId: "acct-alice", venueId: "venue-2", venueName: "The Dove" }]]);
  idCounter = 0;
});

function drop(id: string, extra: Partial<DropWithPhotos> = {}): DropWithPhotos {
  return {
    id,
    venueId: "venue-1",
    handle: "alice",
    drink: "Bitter",
    priceGbp: null,
    passedDownNote: "",
    era: "",
    vibeTags: [],
    provenance: "community",
    status: "visible",
    visibility: "public",
    createdAt: "2026-10-30T20:00:00.000Z",
    pintPhotoUrl: null,
    venuePhotoUrl: null,
    ...extra,
  } as DropWithPhotos;
}

const VENUE = { id: "venue-1", name: "The Seven Stars" } as Venue;

describe("the With line on the drop card", () => {
  it("asks for every drop on screen in ONE read, skipping rows the server has not stored", async () => {
    const list = [drop(DROP), drop(DROP_2), drop("optimistic-1", { optimistic: { state: "pending" } } as never), drop(DROP)];
    const ids = withSummaryIds(list);
    expect(ids).toEqual([DROP, DROP_2]);

    const urls: string[] = [];
    const summaries = await fetchWithSummaries(ids, async (url) => {
      urls.push(url);
      return Response.json({ drops: { [DROP]: { approved: ["sam"], pending: 0 }, [DROP_2]: { approved: [], pending: 0 } } });
    });
    expect(urls).toEqual([`/api/social/tags/with?drops=${DROP},${DROP_2}`]);
    expect(summaries.get(DROP)).toEqual({ approved: ["sam"], pending: 0 });
    // Nobody tagged: no entry, so the card prints nothing.
    expect(summaries.has(DROP_2)).toBe(false);
  });

  it("a failed read is no lines, never an error", async () => {
    const failed = await fetchWithSummaries([DROP], async () => new Response("no", { status: 503 }));
    expect(failed.size).toBe(0);
  });

  it("paints the drops before the tags arrive, then prints 'with 1 person' and 'with @sam'", () => {
    const props = { venue: VENUE, lastTrainDecision: null, reportDrop: async () => undefined };
    const before = renderToStaticMarkup(createElement(PintDropsList, { ...props, drops: [drop(DROP), drop(DROP_2)] }));
    expect(before.match(/dropCard/g)?.length).toBe(2);
    expect(before).not.toContain("with ");

    const after = renderToStaticMarkup(
      createElement(PintDropsList, {
        ...props,
        drops: [drop(DROP), drop(DROP_2)],
        withSummaries: new Map([
          [DROP, { approved: [], pending: 1 }],
          [DROP_2, { approved: ["sam"], pending: 0 }],
        ]),
      }),
    );
    expect(after).toContain("with 1 person");
    expect(after).toContain('href="/u/sam"');
    expect(after.match(/dropWithLine/g)?.length).toBe(2);
  });
});

describe("a retried save resends its tags and never doubles them", () => {
  it("the retry payload carries the handles through storage", () => {
    const input = {
      clientRequestId: "client-1",
      venueId: "venue-1",
      handle: "alice",
      priceGbp: "",
      drink: "Bitter",
      passedDownNote: "Lovely",
      era: "",
      visibility: "public" as const,
      vibeTags: [],
      pintPhotoUrl: null,
      venuePhotoUrl: null,
      createdAt: "2026-10-30T20:00:00.000Z",
      withHandles: ["sam", "priya"],
    };
    const payload = buildOptimisticSpillRetryPayload(input);
    expect(payload.withHandles).toEqual(["sam", "priya"]);
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    };
    writeOptimisticSpills(storage, upsertOptimisticSpill([], buildOptimisticSpillDrop(input), payload));
    expect(readOptimisticSpills(storage)[0]?.retry?.withHandles).toEqual(["sam", "priya"]);
    // No handles, no key: an untagged drop's payload is unchanged.
    expect("withHandles" in buildOptimisticSpillRetryPayload({ ...input, withHandles: [] })).toBe(false);
  });

  it("sends a drop's tags once, however many attempts ask", async () => {
    expect(await proposeWithTags(DROP, ["sam", "@Sam", "priya"])).toBe(true);
    expect(await proposeWithTags(DROP, ["sam", "priya"])).toBe(false);
    expect(fetchState.calls).toHaveLength(1);
    expect(fetchState.calls[0]?.body).toEqual({ dropId: DROP, handles: ["sam", "priya"] });
    // A new handle on the same drop, or the same handle on another drop, goes.
    await proposeWithTags(DROP, ["sam", "jo"]);
    await proposeWithTags(DROP_2, ["sam"]);
    expect(fetchState.calls.map((call) => call.body)).toEqual([
      { dropId: DROP, handles: ["sam", "priya"] },
      { dropId: DROP, handles: ["jo"] },
      { dropId: DROP_2, handles: ["sam"] },
    ]);
  });

  it("tries a transient failure once more, and a send that failed may go again later", async () => {
    fetchState.statuses = [503, 200];
    expect(await proposeWithTags(DROP, ["sam"])).toBe(true);
    expect(fetchState.calls).toHaveLength(2);

    fetchState.calls = [];
    fetchState.statuses = [503, 503];
    expect(await proposeWithTags(DROP_2, ["sam"])).toBe(false);
    expect(await proposeWithTags(DROP_2, ["sam"])).toBe(true);
    expect(fetchState.calls).toHaveLength(3);
  });

  it("the server writes one row for a repeated proposal", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.propose(ALICE, DROP, ["sam"]);
    await store.propose(ALICE, DROP, ["sam"]);
    expect((await store.summaries([DROP])).get(DROP)).toEqual({ approved: [], pending: 1 });
    expect((await store.inbox(SAM, { lane: "proposed", limit: 20 })).proposals).toHaveLength(1);
  });
});

describe("a tag follows its account through a rename", () => {
  it("prints the current handle, and never an old one somebody else claims", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.propose(ALICE, DROP, ["sam"]);
    const [proposal] = (await store.inbox(SAM, { lane: "proposed", limit: 20 })).proposals;
    await store.act(SAM, proposal?.id ?? "", "approve");

    handles.set(SAM.profileId, "samuel");
    expect((await store.summaries([DROP])).get(DROP)).toEqual({ approved: ["samuel"], pending: 0 });

    // The tagger renamed too: the inbox names them as they are now.
    handles.set(ALICE.profileId, "alice_b");
    const [approved] = (await store.inbox({ ...SAM, handle: "samuel" }, { lane: "approved", limit: 20 })).proposals;
    expect(approved?.taggerHandle).toBe("alice_b");

    // An account that is gone prints no handle at all.
    handles.delete(SAM.profileId);
    expect((await store.summaries([DROP])).get(DROP)).toBeUndefined();
  });
});

describe("With tags on a diary entry", () => {
  it("proposes to the inbox, prints a count, then the handle after approval", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.proposeOnDiary(ALICE, ENTRY, ["sam", "priya"]);

    const [proposal] = (await store.inbox(SAM, { lane: "proposed", limit: 20 })).proposals;
    expect(proposal).toEqual(
      expect.objectContaining({ kind: "with", subject: "diary", dropId: null, taggerHandle: "alice", venueName: "The Dove" }),
    );
    expect(JSON.stringify(proposal)).not.toContain(ENTRY);
    expect((await store.diarySummaries("acct-alice", [ENTRY])).get(ENTRY)).toEqual({ approved: [], pending: 2 });

    await store.act(SAM, proposal?.id ?? "", "approve");
    expect((await store.diarySummaries("acct-alice", [ENTRY])).get(ENTRY)).toEqual({ approved: ["sam"], pending: 1 });
  });

  it("a decline takes it off, and the pair cannot be proposed again", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.proposeOnDiary(ALICE, ENTRY, ["sam"]);
    const [proposal] = (await store.inbox(SAM, { lane: "proposed", limit: 20 })).proposals;
    await store.act(SAM, proposal?.id ?? "", "decline");
    expect((await store.diarySummaries("acct-alice", [ENTRY])).get(ENTRY)).toBeUndefined();
    await store.proposeOnDiary(ALICE, ENTRY, ["sam"]);
    expect((await store.inbox(SAM, { lane: "proposed", limit: 20 })).proposals).toEqual([]);
  });

  it("only the owner tags, only the owner reads, and a block refuses silently", async () => {
    const store = createPintDropWithTagsStore(deps());
    await expect(store.proposeOnDiary(SAM, ENTRY, ["priya"])).rejects.toMatchObject({ kind: "not_owner" });
    await expect(store.proposeOnDiary({ ...ALICE, accountId: undefined }, ENTRY, ["priya"])).rejects.toMatchObject({
      kind: "not_owner",
    });

    blocks.add(`${SAM.profileId}:${ALICE.profileId}`);
    await expect(store.proposeOnDiary(ALICE, ENTRY, ["sam"])).resolves.toBeUndefined();
    expect((await store.inbox(SAM, { lane: "proposed", limit: 20 })).proposals).toEqual([]);

    await store.proposeOnDiary(ALICE, ENTRY, ["priya"]);
    expect((await store.diarySummaries("acct-sam", [ENTRY])).size).toBe(0);
    // A diary tag never shows up as a drop's.
    expect((await store.summaries([ENTRY], ALICE)).size).toBe(0);
  });
});
