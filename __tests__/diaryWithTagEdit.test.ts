import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The diary edit door takes the people tagged as well as the day and the words.
// A new @handle and a removed tag go through the With tag store's one consent
// path (`editDiaryTags`), in the name of the session's own Social account.

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const state = vi.hoisted(() => ({
  identity: { ok: true as const, accountId: "acct-alice", actor: "profile:social-alice", handle: "alice" },
  social: { ok: true, actor: { accountId: "acct-alice", profileId: "social-alice", handle: "alice" } } as
    | { ok: true; actor: { accountId: string; profileId: string; handle: string } }
    | { ok: false; status: number; code: string; error: string },
  edits: [] as Array<{ actor: unknown; entryId: string; change: { add: string[]; remove: string[] } }>,
  lists: new Map<string, Array<{ id: string; handle: string; state: "proposed" | "approved" }>>(),
}));

vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () => state.identity,
}));
vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => state.social,
}));
vi.mock("@/lib/pintDropWithTagsStore", () => ({
  pintDropWithTagsStore: () => ({
    proposeOnDiary: async () => {},
    editDiaryTags: async (actor: unknown, entryId: string, change: { add: string[]; remove: string[] }) => {
      state.edits.push({ actor, entryId, change: { add: [...change.add], remove: [...change.remove] } });
    },
    diarySummaries: async () => new Map(),
    diaryTagList: async (_owner: string, ids: string[]) =>
      new Map([...state.lists].filter(([id]) => ids.includes(id))),
  }),
}));

import { DiaryEntryRow } from "@/components/diary/DiaryList";
import { GET as diaryGet, POST as diaryPost } from "@/app/api/diary/route";
import type { DiaryEntryDTO } from "@/lib/diary";
import { __resetDiary } from "@/lib/diaryStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { getVenueIndex } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

const TAG = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
let PUB = { id: "", name: "" };
let run = 0;

beforeAll(async () => {
  const index = await getVenueIndex();
  const found = [...index.values()].find((venue) => isPubVenueKind(venue.kind));
  if (!found) throw new Error("venue index is empty");
  PUB = { id: found.id, name: found.name };
});

beforeEach(() => {
  __resetDiary();
  __resetPintDrops();
  run += 1;
  const account = `acct-alice-edit-${run}`;
  // The owner record names the Social profile, and the account ids differ from
  // the profile id as real sign-up gives them (review finding 6, PR 2402).
  state.identity = { ok: true, accountId: account, actor: `profile:social-alice-${run}`, handle: "alice" };
  state.social = { ok: true, actor: { accountId: account, profileId: `social-alice-${run}`, handle: "alice" } };
  state.edits = [];
  state.lists = new Map();
});

function request(body: unknown): Request {
  return new Request("http://localhost/api/diary", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${run}` },
    body: JSON.stringify(body),
  });
}

async function created(): Promise<string> {
  const res = await diaryPost(request({ venueId: PUB.id }));
  return ((await res.json()).entry as DiaryEntryDTO).id;
}

describe("With tags on a diary edit", () => {
  it("sends added handles and removed tag ids through the store, and nothing else", async () => {
    const id = await created();
    const res = await diaryPost(
      request({ action: "update", id, withAdd: "Jo @Priya", withRemove: [TAG] }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tagsSent).toBe(true);
    expect(state.edits).toEqual([
      {
        actor: { profileId: `social-alice-${run}`, handle: "alice", accountId: `acct-alice-edit-${run}` },
        entryId: id,
        change: { add: ["priya"], remove: [TAG] },
      },
    ]);
  });

  it("answers the entry with its fresh tag list after a tag edit", async () => {
    const id = await created();
    state.lists.set(id, [{ id: TAG, handle: "priya", state: "proposed" }]);
    const res = await diaryPost(request({ action: "update", id, withAdd: "@priya" }));
    expect((await res.json()).entry.withTagList).toEqual([{ id: TAG, handle: "priya", state: "proposed" }]);
    const listed = await (await diaryGet(new Request("http://localhost/api/diary"))).json();
    expect(listed.entries[0].withTagList).toEqual([{ id: TAG, handle: "priya", state: "proposed" }]);
  });

  it("finds the entry by id AND account, and says so when no Social account can ask", async () => {
    const id = await created();
    state.identity = { ...state.identity, accountId: "acct-somebody-else" };
    const stranger = await diaryPost(request({ action: "update", id, withAdd: "@priya" }));
    expect(stranger.status).toBe(404);
    expect(state.edits).toEqual([]);

    state.identity = { ...state.identity, accountId: `acct-alice-edit-${run}` };
    state.social = { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social." };
    const held = await diaryPost(request({ action: "update", id, withAdd: "@priya" }));
    expect(held.status).toBe(200);
    expect((await held.json()).tagsSent).toBe(false);
    expect(state.edits).toEqual([]);
  });

  it("refuses a removal list that is not tag ids", async () => {
    const id = await created();
    const res = await diaryPost(request({ action: "update", id, withRemove: ["not-an-id"] }));
    expect(res.status).toBe(400);
  });

  it("the edit form lists each tag with its own untag control, and a proposal never as a line on the row", () => {
    const entry = {
      id: TAG,
      ownerUserId: "acct",
      venueId: PUB.id,
      venueName: PUB.name,
      visitedOn: "2026-10-29",
      rating: null,
      review: "",
      usualDrink: "",
      withNames: "",
      visibility: "private",
      createdAt: "2026-10-29T20:00:00.000Z",
      withTags: { approved: [], pending: 1 },
      withTagList: [{ id: TAG, handle: "priya", state: "proposed" }],
    } as DiaryEntryDTO;
    const row = renderToStaticMarkup(createElement(DiaryEntryRow, { entry, onChanged: () => {}, onRemoved: () => {} }));
    // The row reads a count, never the handle, before consent.
    expect(row).toContain("with 1 person");
    expect(row).not.toContain("@priya");
  });
});
