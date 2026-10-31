import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The diary route's two round-3 doors: the "With" field on a log (names kept
// on the entry, each @handle proposed through the With tag store in the name
// of the session's own Social account) and "Your usual here" on an edit.

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const state = vi.hoisted(() => ({
  identity: { ok: true as const, accountId: "acct-alice", actor: "profile:alice", handle: "alice" },
  social: { ok: true, actor: { accountId: "acct-alice", profileId: "social-alice", handle: "alice" } } as
    | { ok: true; actor: { accountId: string; profileId: string; handle: string } }
    | { ok: false; status: number; code: string; error: string },
  proposals: [] as Array<{ actor: unknown; entryId: string; handles: string[] }>,
  summaries: new Map<string, { approved: string[]; pending: number }>(),
}));

vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () => state.identity,
}));
vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => state.social,
}));
vi.mock("@/lib/pintDropWithTagsStore", () => ({
  pintDropWithTagsStore: () => ({
    proposeOnDiary: async (actor: unknown, entryId: string, handles: string[]) => {
      state.proposals.push({ actor, entryId, handles: [...handles] });
    },
    diarySummaries: async (_owner: string, ids: string[]) =>
      new Map([...state.summaries].filter(([id]) => ids.includes(id))),
  }),
}));

import { DiaryEntryRow } from "@/components/diary/DiaryList";
import { GET as diaryGet, POST as diaryPost } from "@/app/api/diary/route";
import type { DiaryEntryDTO } from "@/lib/diary";
import { __resetDiary } from "@/lib/diaryStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { getVenueIndex } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

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
  // A provisioned account: the auth user id owns the diary, the Social record
  // has its own id, and both verify the same profile (review finding 6).
  const account = `acct-alice-${run}`;
  state.identity = { ok: true, accountId: account, actor: `profile:social-alice-${run}`, handle: "alice" };
  state.social = { ok: true, actor: { accountId: `psa-alice-${run}`, profileId: `social-alice-${run}`, handle: "alice" } };
  state.proposals = [];
  state.summaries = new Map();
});

function request(body: unknown): Request {
  return new Request("http://localhost/api/diary", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${run}` },
    body: JSON.stringify(body),
  });
}

async function list(): Promise<DiaryEntryDTO[]> {
  const res = await diaryGet(new Request("http://localhost/api/diary"));
  return (await res.json()).entries as DiaryEntryDTO[];
}

describe("With on a diary log", () => {
  it("keeps the names, never a handle, and proposes each handle from the owner's Social account", async () => {
    const res = await diaryPost(request({ venueId: PUB.id, withWho: "Jo, @Sam Dan @priya" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.entry.withNames).toBe("Jo, Dan");
    expect(JSON.stringify(body.entry)).not.toContain("sam");
    expect(body.tagsSent).toBe(true);
    expect(state.proposals).toEqual([
      {
        actor: { profileId: `social-alice-${run}`, handle: "alice", accountId: `acct-alice-${run}` },
        entryId: body.entry.id,
        handles: ["sam", "priya"],
      },
    ]);
  });

  it("sends nothing without handles, and says so when there is no Social account to ask from", async () => {
    const plain = await diaryPost(request({ venueId: PUB.id, withWho: "Jo" }));
    expect("tagsSent" in (await plain.json())).toBe(false);
    expect(state.proposals).toEqual([]);

    __resetDiary();
    state.social = { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social." };
    const held = await diaryPost(request({ venueId: PUB.id, withWho: "@sam" }));
    expect(held.status).toBe(201);
    expect((await held.json()).tagsSent).toBe(false);
    expect(state.proposals).toEqual([]);
  });

  it("refuses a With field that is not text", async () => {
    const res = await diaryPost(request({ venueId: PUB.id, withWho: ["@sam"] }));
    expect(res.status).toBe(400);
  });

  it("the owner's list carries 'with @sam' only once the store says it was approved", async () => {
    const created = await (await diaryPost(request({ venueId: PUB.id, withWho: "@sam" }))).json();
    expect((await list())[0]?.withTags).toBeUndefined();

    state.summaries.set(created.entry.id, { approved: [], pending: 1 });
    const pending = (await list())[0]!;
    expect(pending.withTags).toEqual({ approved: [], pending: 1 });
    expect(renderToStaticMarkup(createElement(DiaryEntryRow, { entry: pending, onChanged: () => {}, onRemoved: () => {} })))
      .toContain("with 1 person");

    state.summaries.set(created.entry.id, { approved: ["sam"], pending: 0 });
    const approved = (await list())[0]!;
    const html = renderToStaticMarkup(
      createElement(DiaryEntryRow, { entry: approved, onChanged: () => {}, onRemoved: () => {} }),
    );
    expect(html).toContain('href="/u/sam"');
    expect(html).toContain("@sam");
  });
});

describe("Your usual here on an edit", () => {
  it("round-trips through the edit door with the same 40 character cap", async () => {
    const created = await (await diaryPost(request({ venueId: PUB.id }))).json();
    const id = created.entry.id as string;

    const edited = await diaryPost(request({ action: "update", id, usualDrink: "  Harvey's   Best " }));
    expect(edited.status).toBe(200);
    expect((await edited.json()).entry.usualDrink).toBe("Harvey's Best");
    expect((await list())[0]?.usualDrink).toBe("Harvey's Best");

    const tooLong = await diaryPost(request({ action: "update", id, usualDrink: "x".repeat(41) }));
    expect(tooLong.status).toBe(400);

    const cleared = await diaryPost(request({ action: "update", id, usualDrink: "" }));
    expect((await cleared.json()).entry.usualDrink).toBe("");
  });
});
