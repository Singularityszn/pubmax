// A PUBLISHED NIGHT STORY WE COULD NOT READ HAS NOT VANISHED.
//
// astra-review P1-1. `getPublishedRecapSource` collapsed a PostgREST error from
// `night_stories` or `night_moments` into the same null a missing, private or
// unpublished Story answers, and `/recap/[storyId]` turned that null into
// `notFound()`. A crew standing on a published Story during an outage was told
// the Story does not exist. `/plan/[id]/recap` already answers `unavailable`
// and `absent` apart (#1594, #1602); this file holds the public recap to the
// same three answers, rendered rather than read off the source.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

type TableAnswer = { data: unknown; error: { message: string } | null };

const store = vi.hoisted(() => ({
  configured: true,
  answers: new Map<string, TableAnswer>(),
  asked: [] as string[],
}));

/** One PostgREST-shaped chain: every builder method returns itself, and the
 * chain settles on the answer the test configured for its table. */
function chainFor(table: string) {
  store.asked.push(table);
  const answer = store.answers.get(table) ?? { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit", "maybeSingle", "single"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: TableAnswer) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(answer).then(resolve, reject);
  return chain;
}

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => store.configured,
    requireSupabaseAdmin: () => ({ from: (table: string) => chainFor(table) }),
  };
});

import PublicRecapPage, { generateMetadata } from "@/app/recap/[storyId]/page";
import { readPublishedRecapSource } from "@/lib/nightMemoryStore";

const STORY_ID = "0b6d6f4e-3f6f-4d0a-9d2e-3c1f0d2a5b7c";
const MEMORY_ID = "memory-1";
const OUTAGE = { message: "canceling statement due to statement timeout" };

function publishedStoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STORY_ID,
    memory_id: MEMORY_ID,
    host_editor_id: "host",
    title: "Friday orbit",
    summary: "",
    status: "published",
    visibility: "public",
    legacy_crawl_story_id: null,
    published_at: "2026-09-04T22:00:00.000Z",
    created_at: "2026-09-04T18:00:00.000Z",
    updated_at: "2026-09-04T22:00:00.000Z",
    ...overrides,
  };
}

function momentRow(id: string) {
  return {
    id,
    memory_id: MEMORY_ID,
    owner_id: "host",
    kind: "quote",
    caption: "One more side quest",
    occurred_at: "2026-09-04T20:00:00.000Z",
    created_at: "2026-09-04T20:00:00.000Z",
  };
}

/** A published, public Story with one published Moment, so the moments read runs. */
function seedPublishedStory() {
  store.answers.set("night_stories", { data: publishedStoryRow(), error: null });
  store.answers.set("night_story_moments", { data: [{ moment_id: "m1" }], error: null });
  store.answers.set("night_moments", { data: [momentRow("m1")], error: null });
}

async function renderPage(): Promise<string> {
  const element = await PublicRecapPage({ params: Promise.resolve({ storyId: STORY_ID }) });
  return renderToStaticMarkup(createElement(() => element));
}

beforeEach(() => {
  store.configured = true;
  store.answers.clear();
  store.asked.length = 0;
});

describe("the store read has three answers", () => {
  it("answers found when every read ran", async () => {
    seedPublishedStory();
    const read = await readPublishedRecapSource(STORY_ID);
    expect(read.status).toBe("found");
    if (read.status !== "found") return;
    expect(read.source.story.title).toBe("Friday orbit");
    expect(read.source.moments.map((moment) => moment.id)).toEqual(["m1"]);
  });

  it("answers unavailable when the moments read failed, never absent", async () => {
    seedPublishedStory();
    store.answers.set("night_moments", { data: null, error: OUTAGE });
    await expect(readPublishedRecapSource(STORY_ID)).resolves.toEqual({ status: "unavailable" });
  });

  it("answers unavailable when the story read itself failed", async () => {
    seedPublishedStory();
    store.answers.set("night_stories", { data: null, error: OUTAGE });
    await expect(readPublishedRecapSource(STORY_ID)).resolves.toEqual({ status: "unavailable" });
  });

  it("still answers absent for a Story that is missing, private or unpublished", async () => {
    store.answers.set("night_stories", { data: null, error: null });
    await expect(readPublishedRecapSource(STORY_ID)).resolves.toEqual({ status: "absent" });

    seedPublishedStory();
    store.answers.set("night_stories", { data: publishedStoryRow({ visibility: "private" }), error: null });
    await expect(readPublishedRecapSource(STORY_ID)).resolves.toEqual({ status: "absent" });

    store.answers.set("night_stories", { data: publishedStoryRow({ status: "draft" }), error: null });
    await expect(readPublishedRecapSource(STORY_ID)).resolves.toEqual({ status: "absent" });
    // The gate refuses before it reads a single Moment, so nothing private leaks.
    expect(store.asked).not.toContain("night_moments");
  });
});

describe("the public recap page words a failed read as ours", () => {
  it("renders the unavailable surface over a mocked night_moments error, not the not-found document", async () => {
    seedPublishedStory();
    store.answers.set("night_moments", { data: null, error: OUTAGE });

    const markup = await renderPage();
    expect(markup).toContain("We could not load this recap");
    expect(markup).toContain("could not answer just now");
    // The way onward is the reader's OWN address, as a plain anchor, so a
    // retry is a fresh server read rather than the held payload.
    expect(markup).toContain(`href="/recap/${STORY_ID}"`);
    expect(markup).toContain("Try again");
    // docs/VOICE.md: never a closed door.
    expect(markup).not.toMatch(/check back later|try again later|please try again/i);
  });

  it("renders the unavailable surface over a mocked night_stories error too", async () => {
    seedPublishedStory();
    store.answers.set("night_stories", { data: null, error: OUTAGE });
    const markup = await renderPage();
    expect(markup).toContain("We could not load this recap");
  });

  it("keeps notFound() for a Story that is missing, private or unpublished", async () => {
    store.answers.set("night_stories", { data: null, error: null });
    await expect(renderPage()).rejects.toThrow("notFound");

    seedPublishedStory();
    store.answers.set("night_stories", { data: publishedStoryRow({ visibility: "private" }), error: null });
    await expect(renderPage()).rejects.toThrow("notFound");

    store.answers.set("night_stories", { data: publishedStoryRow({ status: "draft" }), error: null });
    await expect(renderPage()).rejects.toThrow("notFound");
  });

  it("claims nothing in the unfurl when the read could not run", async () => {
    seedPublishedStory();
    store.answers.set("night_moments", { data: null, error: OUTAGE });
    const metadata = await generateMetadata({ params: Promise.resolve({ storyId: STORY_ID }) });
    expect(metadata.title).toBe("Recap · PUBMAXXING");
    expect(metadata.robots).toEqual({ index: false });
    expect(JSON.stringify(metadata)).not.toContain("Friday orbit");
  });
});
