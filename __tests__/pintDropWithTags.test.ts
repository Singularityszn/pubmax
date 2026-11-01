import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import PintDropWithLine from "@/components/map/composer/PintDropWithLine";
import { currentWithToken, pickWithHandle } from "@/components/map/composer/WithTagField";
import { withTagHandlesFor } from "@/components/map/composer/proposeWithTags";
import {
  EMPTY_WITH_SUMMARY,
  formatWithLine,
  parseWithSummary,
  splitWithInput,
} from "@/lib/pintDropWithTags";
import {
  __resetMemoryWithTags,
  createPintDropWithTagsStore,
  memoryWithTagRows,
  WithTagError,
  type WithTagActor,
  type WithTagDependencies,
  type WithTagDrop,
} from "@/lib/pintDropWithTagsStore";
import { appendWithSuffix } from "@/lib/spill";
import { buildSpillPreview } from "@/lib/spillPreview";

// "With" on a Pint Drop as consented handle tags (WEEK1_HYGIENE_BUILD round 2,
// "Tag who you went with"). A handle is a proposal until the person tagged
// approves it, and a reader sees "with 1 person" until then.

const DROP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALICE: WithTagActor = { profileId: "11111111-1111-4111-8111-111111111111", handle: "alice" };
const SAM: WithTagActor = { profileId: "22222222-2222-4222-8222-222222222222", handle: "sam" };
const PRIYA: WithTagActor = { profileId: "33333333-3333-4333-8333-333333333333", handle: "priya" };
const STRANGER: WithTagActor = { profileId: "44444444-4444-4444-8444-444444444444", handle: "stranger" };

let blocks: Set<string>;
let drops: Map<string, WithTagDrop>;
let idCounter = 0;

function deps(): WithTagDependencies {
  const profiles = new Map([ALICE, SAM, PRIYA, STRANGER].map((actor) => [actor.handle, actor]));
  return {
    rows: memoryWithTagRows,
    drop: async (id) => drops.get(id) ?? null,
    diaryEntry: async () => null,
    currentHandles: async (ids) =>
      new Map([ALICE, SAM, PRIYA, STRANGER].filter((actor) => ids.includes(actor.profileId)).map((actor) => [actor.profileId, actor.handle])),
    claimedProfile: async (handle) => {
      const actor = profiles.get(handle);
      return actor ? { id: actor.profileId, handle: actor.handle } : null;
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
  blocks = new Set();
  drops = new Map([[DROP, { handle: "alice", visibility: "public", status: "visible", venueId: "venue-1" }]]);
  idCounter = 0;
});

async function inboxIds(actor: WithTagActor, lane: "proposed" | "approved") {
  const store = createPintDropWithTagsStore(deps());
  return (await store.inbox(actor, { lane, limit: 20 })).proposals.map((item) => item.id);
}

describe("the With field keeps names and proposes handles", () => {
  it("splits free-text names from @handles and caps the handles", () => {
    expect(splitWithInput("Jo, @Sam @priya Dan")).toEqual({ names: "Jo, Dan", handles: ["sam", "priya"] });
    expect(splitWithInput("@a1 @a2 @a3 @a4 @a5 @a6 @a7").handles).toHaveLength(6);
  });

  it("never folds a handle into the note, so it cannot print before consent", () => {
    expect(appendWithSuffix("Great pint.", "@sam, Jo")).toBe("Great pint. with Jo");
    expect(appendWithSuffix("", "@sam")).toBe("");
  });

  it("the composer preview says 'with 1 person' and never the handle", () => {
    const preview = buildSpillPreview({
      handle: "alice", price: "", note: "Cracking", withWho: "@sam", drink: "", era: "",
      visibility: "public", venueName: "The Seven Stars", hasPhoto: false,
    });
    expect(preview.withLine).toBe("with 1 person");
    expect(`${preview.note} ${preview.withLine}`).not.toContain("@sam");
  });

  it("an anonymous drop proposes nothing", () => {
    expect(withTagHandlesFor("@sam", "anonymous")).toEqual([]);
    expect(withTagHandlesFor("@sam", "public")).toEqual(["sam"]);
  });

  it("picking a match replaces the token being typed", () => {
    expect(currentWithToken("Jo, @sa")).toBe("@sa");
    expect(pickWithHandle("Jo, @sa", "sam")).toBe("Jo, @sam, ");
  });
});

describe("the with line", () => {
  it("prints a count before approval and the handle after", () => {
    expect(formatWithLine({ approved: [], pending: 1 })).toBe("with 1 person");
    expect(formatWithLine({ approved: ["sam"], pending: 0 })).toBe("with @sam");
    expect(formatWithLine({ approved: ["sam"], pending: 2 })).toBe("with @sam and 2 people");
    expect(formatWithLine(EMPTY_WITH_SUMMARY)).toBe("");
  });

  it("reads an untrusted summary defensively", () => {
    expect(parseWithSummary({ approved: ["@Sam", 4], pending: -2 })).toEqual({ approved: ["sam"], pending: 0 });
    expect(parseWithSummary(null)).toEqual(EMPTY_WITH_SUMMARY);
  });
});

describe("with-tag consent", () => {
  it("a proposal lands in the tagged person's inbox and the drop shows a count, never the handle", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.propose(ALICE, DROP, ["sam"]);

    const page = await store.inbox(SAM, { lane: "proposed", limit: 20 });
    expect(page.proposals).toEqual([
      expect.objectContaining({ kind: "with", dropId: DROP, taggerHandle: "alice", venueName: "The Seven Stars" }),
    ]);
    expect(await inboxIds(ALICE, "proposed")).toEqual([]);

    const summary = (await store.summaries([DROP])).get(DROP);
    expect(summary).toEqual({ approved: [], pending: 1 });
    const html = renderToStaticMarkup(createElement(PintDropWithLine, { summary: summary ?? EMPTY_WITH_SUMMARY }));
    expect(html).toContain("with 1 person");
    expect(html).not.toContain("sam");
  });

  it("approval prints the handle and links it to their profile", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.propose(ALICE, DROP, ["sam"]);
    const [proposal] = (await store.inbox(SAM, { lane: "proposed", limit: 20 })).proposals;
    await store.act(SAM, proposal?.id ?? "", "approve");

    const summary = (await store.summaries([DROP])).get(DROP);
    expect(summary).toEqual({ approved: ["sam"], pending: 0 });
    const html = renderToStaticMarkup(createElement(PintDropWithLine, { summary: summary ?? EMPTY_WITH_SUMMARY }));
    expect(html).toContain('href="/u/sam"');
    expect(html).toContain("@sam");
    expect(await inboxIds(SAM, "approved")).toEqual([proposal?.id]);
  });

  it("a decline removes it, and the pair cannot be proposed again", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.propose(ALICE, DROP, ["sam"]);
    const [proposal] = (await store.inbox(SAM, { lane: "proposed", limit: 20 })).proposals;
    await store.act(SAM, proposal?.id ?? "", "decline");

    expect((await store.summaries([DROP])).get(DROP)).toBeUndefined();
    await store.propose(ALICE, DROP, ["sam"]);
    expect(await inboxIds(SAM, "proposed")).toEqual([]);
  });

  it("withdrawal takes an approved tag off the drop, the same as a photo tag", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.propose(ALICE, DROP, ["sam", "priya"]);
    const [samTag] = (await store.inbox(SAM, { lane: "proposed", limit: 20 })).proposals;
    await store.act(SAM, samTag?.id ?? "", "approve");
    await store.act(SAM, samTag?.id ?? "", "withdraw");

    expect((await store.summaries([DROP])).get(DROP)).toEqual({ approved: [], pending: 1 });
    expect(await inboxIds(SAM, "approved")).toEqual([]);
    // A repeated withdrawal is idempotent; a stranger cannot act at all.
    await expect(store.act(SAM, samTag?.id ?? "", "withdraw")).resolves.toBeUndefined();
    const [priyaTag] = (await store.inbox(PRIYA, { lane: "proposed", limit: 20 })).proposals;
    await expect(store.act(STRANGER, priyaTag?.id ?? "", "approve")).rejects.toBeInstanceOf(WithTagError);
    // The tagger cancels instead of the tagged person.
    await store.act(ALICE, priyaTag?.id ?? "", "cancel");
    expect((await store.summaries([DROP])).get(DROP)).toBeUndefined();
  });

  it("only the drop's author may propose, and an anonymous drop takes no tags", async () => {
    const store = createPintDropWithTagsStore(deps());
    await expect(store.propose(SAM, DROP, ["priya"])).rejects.toMatchObject({ kind: "not_owner" });
    drops.set(DROP, { handle: "alice", visibility: "anonymous", status: "visible", venueId: "venue-1" });
    await expect(store.propose(ALICE, DROP, ["priya"])).rejects.toMatchObject({ kind: "not_owner" });
    expect(await inboxIds(PRIYA, "proposed")).toEqual([]);
  });

  it("needs a live claimed handle and never the author's own", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.propose(ALICE, DROP, ["nobody_here", "alice"]);
    expect((await store.summaries([DROP])).get(DROP)).toBeUndefined();
  });

  it("a block between the pair refuses the tag silently", async () => {
    blocks.add(`${SAM.profileId}:${ALICE.profileId}`);
    const store = createPintDropWithTagsStore(deps());
    await expect(store.propose(ALICE, DROP, ["sam"])).resolves.toBeUndefined();
    expect(await inboxIds(SAM, "proposed")).toEqual([]);
    expect((await store.summaries([DROP])).get(DROP)).toBeUndefined();
  });

  it("a block made after the proposal stops the approval and hides it from the inbox", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.propose(ALICE, DROP, ["sam"]);
    const [proposal] = (await store.inbox(SAM, { lane: "proposed", limit: 20 })).proposals;
    blocks.add(`${ALICE.profileId}:${SAM.profileId}`);
    await expect(store.act(SAM, proposal?.id ?? "", "approve")).rejects.toBeInstanceOf(WithTagError);
    expect(await inboxIds(SAM, "proposed")).toEqual([]);
  });

  it("answers summaries only for drops a stranger may read, plus the author's own", async () => {
    const store = createPintDropWithTagsStore(deps());
    await store.propose(ALICE, DROP, ["sam"]);
    drops.set(DROP, { handle: "alice", visibility: "friends", status: "visible", venueId: "venue-1" });
    expect((await store.summaries([DROP])).get(DROP)).toBeUndefined();
    expect((await store.summaries([DROP], ALICE)).get(DROP)).toEqual({ approved: [], pending: 1 });
  });
});
