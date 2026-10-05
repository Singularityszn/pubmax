// A PUBLISHED NIGHT STORY WE COULD NOT READ HAS NOT VANISHED.
//
// astra-review P1-1. `getPublishedRecapSource` collapsed a PostgREST error from
// `night_stories` or `night_moments` into the same null a missing, private or
// unpublished Story answers, and `/recap/[storyId]` turned that null into
// `notFound()`. A crew standing on a published Story during an outage was told
// the Story does not exist. `/plan/[id]/recap` already answers `unavailable`
// and `absent` apart (#1594, #1602); this file holds the public recap to the
// same three answers, rendered rather than read off the source.

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/lib/authServer", () => ({ callerUserId: async () => null }));
vi.mock("next/og", () => ({
  ImageResponse: class ImageResponse {
    element: unknown;
    headers: Record<string, string>;

    constructor(element: unknown, options: { headers?: Record<string, string> }) {
      this.element = element;
      this.headers = options.headers ?? {};
    }
  },
}));

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

import { GET as GET_STORY } from "@/app/api/night-stories/[id]/route";
import OpenGraphImage from "@/app/recap/[storyId]/opengraph-image";
import PublicRecapPage, { generateMetadata } from "@/app/recap/[storyId]/page";
import { getNightStory, readNightStory, readPublishedRecapSource } from "@/lib/nightMemoryStore";
import { RECAP_OG_CACHE_HEADERS } from "@/lib/recapCard";
import { defined } from "@/__tests__/helpers/defined";

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

function momentRow(id: string, ownerId = "host") {
  return {
    id,
    memory_id: MEMORY_ID,
    owner_id: ownerId,
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

/** A crew member who deleted their account: their contributor row is withdrawn,
 * and by design their published Moment still sits in the source, so only the
 * emission gate stands between it and the public page. */
function seedWithdrawnContributorWithMoment() {
  store.answers.set("night_story_moments", { data: [{ moment_id: "m1" }, { moment_id: "m2" }], error: null });
  store.answers.set("night_moments", { data: [momentRow("m1"), momentRow("m2", "departed")], error: null });
  store.answers.set("night_story_contributors", {
    data: [
      { story_id: STORY_ID, profile_id: "host", role: "host", status: "accepted", joined_at: "2026-09-04T18:00:00.000Z" },
      { story_id: STORY_ID, profile_id: "departed", role: "contributor", status: "withdrawn", joined_at: "2026-09-04T18:30:00.000Z" },
    ],
    error: null,
  });
  store.answers.set("night_moment_consents", {
    data: [
      { story_id: STORY_ID, moment_id: "m1", owner_id: "host", status: "approved", decided_at: "2026-09-04T21:00:00.000Z" },
      { story_id: STORY_ID, moment_id: "m2", owner_id: "departed", status: "approved", decided_at: "2026-09-04T21:00:00.000Z" },
    ],
    error: null,
  });
}

type OgResponse = { element: ReactNode; headers: Record<string, string> };

async function renderOgCard(): Promise<{ markup: string; cacheControl: string }> {
  const response = (await OpenGraphImage({ params: Promise.resolve({ storyId: STORY_ID }) })) as unknown as OgResponse;
  return { markup: renderToStaticMarkup(response.element), cacheControl: defined(response.headers["cache-control"]) };
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

  it("redacts a withdrawn contributor's Moment when every read ran", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    const read = await readPublishedRecapSource(STORY_ID);
    expect(read.status).toBe("found");
    if (read.status !== "found") return;
    expect(read.source.moments.map((moment) => moment.id)).toEqual(["m1"]);
  });

  it("answers unavailable when the contributors read failed, never a found source with the departed Moment", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    store.answers.set("night_story_contributors", { data: null, error: OUTAGE });
    await expect(readPublishedRecapSource(STORY_ID)).resolves.toEqual({ status: "unavailable" });
    // Refused before a single Moment was read.
    expect(store.asked).not.toContain("night_moments");
  });

  it("answers unavailable when the consents read failed, never a found source with the departed Moment", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    store.answers.set("night_moment_consents", { data: null, error: OUTAGE });
    await expect(readPublishedRecapSource(STORY_ID)).resolves.toEqual({ status: "unavailable" });
    expect(store.asked).not.toContain("night_moments");
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

describe("the public Story projection behind the OG card", () => {
  it("answers the redacted Story when every read ran", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    const story = await getNightStory(STORY_ID, null);
    expect(story?.title).toBe("Friday orbit");
  });

  it("answers null when the contributors read failed, never an un-redacted Story", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    store.answers.set("night_story_contributors", { data: null, error: OUTAGE });
    await expect(getNightStory(STORY_ID, null)).resolves.toBeNull();
  });

  it("answers null when the consents read failed, never an un-redacted Story", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    store.answers.set("night_moment_consents", { data: null, error: OUTAGE });
    await expect(getNightStory(STORY_ID, null)).resolves.toBeNull();
  });
});

describe("the departed profile read fails closed, and only for a Story with someone to protect", () => {
  it("answers unavailable when the profile read failed, never a Story carrying the departed handle", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    store.answers.set("night_stories", {
      data: publishedStoryRow({ title: "Friday orbit with @departed" }),
      error: null,
    });
    store.answers.set("profiles", { data: null, error: OUTAGE });

    await expect(readPublishedRecapSource(STORY_ID)).resolves.toEqual({ status: "unavailable" });
    const markup = await renderPage();
    expect(markup).toContain("We could not load this recap");
    expect(markup).not.toContain("@departed");

    const card = await renderOgCard();
    expect(card.markup).not.toContain("@departed");
    expect(card.cacheControl).not.toBe("public, s-maxage=86400, stale-while-revalidate=604800");
    expect(card.cacheControl).toBe("no-store");
  });

  it("keeps a Story with nobody to protect out of the profiles outage entirely", async () => {
    seedPublishedStory();
    store.answers.set("profiles", { data: null, error: OUTAGE });

    const read = await readPublishedRecapSource(STORY_ID);
    expect(read.status).toBe("found");
    const markup = await renderPage();
    expect(markup).toContain("Friday orbit");
    // No withdrawn contributor and no withdrawn consent, so no profile is ever
    // asked for: the blast radius stays with the Stories that have a departed
    // person. Move the empty-set return below the profile read and this fails.
    expect(store.asked).not.toContain("profiles");

    const card = await renderOgCard();
    expect(card.markup).toContain("Friday orbit");
    expect(card.cacheControl).toBe(RECAP_OG_CACHE_HEADERS.rich);
  });

  it("still redacts the owned Moments when a departed profile row is simply missing", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    store.answers.set("profiles", { data: [], error: null });

    const read = await readPublishedRecapSource(STORY_ID);
    expect(read.status).toBe("found");
    if (read.status !== "found") return;
    expect(read.source.moments.map((moment) => moment.id)).toEqual(["m1"]);
  });
});

describe("the OG card never pins an outage as a not-shared Story", () => {
  it("reads the public Story three ways", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    const found = await readNightStory(STORY_ID, null);
    expect(found.status).toBe("found");

    store.answers.set("night_story_contributors", { data: null, error: OUTAGE });
    await expect(readNightStory(STORY_ID, null)).resolves.toEqual({ status: "unavailable" });

    store.answers.set("night_stories", { data: null, error: null });
    await expect(readNightStory(STORY_ID, null)).resolves.toEqual({ status: "absent" });
  });

  it("paints the fallback card with no-store when the contributors read failed", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    store.answers.set("night_story_contributors", { data: null, error: OUTAGE });
    const { markup, cacheControl } = await renderOgCard();
    expect(markup).not.toContain("Friday orbit");
    expect(cacheControl).toBe("no-store");
  });

  it("paints the fallback card with no-store when the consents read failed", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    store.answers.set("night_moment_consents", { data: null, error: OUTAGE });
    const { markup, cacheControl } = await renderOgCard();
    expect(markup).not.toContain("Friday orbit");
    expect(cacheControl).toBe("no-store");
  });

  it("keeps the day-long fallback header for a Story that is absent or private", async () => {
    store.answers.set("night_stories", { data: null, error: null });
    let card = await renderOgCard();
    expect(card.markup).not.toContain("Friday orbit");
    expect(card.cacheControl).toBe("public, s-maxage=86400, stale-while-revalidate=604800");

    seedPublishedStory();
    store.answers.set("night_stories", { data: publishedStoryRow({ visibility: "private" }), error: null });
    card = await renderOgCard();
    expect(card.markup).not.toContain("Friday orbit");
    expect(card.cacheControl).toBe("public, s-maxage=86400, stale-while-revalidate=604800");
  });

  it("keeps the short rich header when every read ran", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    const { markup, cacheControl } = await renderOgCard();
    expect(markup).toContain("Friday orbit");
    expect(cacheControl).toBe(RECAP_OG_CACHE_HEADERS.rich);
  });
});

describe("the public Story API answers an outage apart from an absence", () => {
  const getStory = () =>
    GET_STORY(new Request(`http://localhost/api/night-stories/${STORY_ID}`), {
      params: Promise.resolve({ id: STORY_ID }),
    });

  it("serves the redacted Story when every read ran", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    const response = await getStory();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ story: { id: STORY_ID, title: "Friday orbit" } });
  });

  it("answers 503 retryable when the contributors read failed, never 404", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    store.answers.set("night_story_contributors", { data: null, error: OUTAGE });
    const response = await getStory();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "STORY_STORE_UNAVAILABLE", retryable: true });
  });

  it("answers 503 retryable when the consents read failed, never 404", async () => {
    seedPublishedStory();
    seedWithdrawnContributorWithMoment();
    store.answers.set("night_moment_consents", { data: null, error: OUTAGE });
    const response = await getStory();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "STORY_STORE_UNAVAILABLE", retryable: true });
  });

  it("keeps 404 for a Story that is missing or private", async () => {
    store.answers.set("night_stories", { data: null, error: null });
    let response = await getStory();
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND", retryable: false });

    seedPublishedStory();
    store.answers.set("night_stories", { data: publishedStoryRow({ visibility: "private" }), error: null });
    response = await getStory();
    expect(response.status).toBe(404);
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
