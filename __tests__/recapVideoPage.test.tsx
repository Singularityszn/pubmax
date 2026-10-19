// The public recap page carries the video only when PUBMAX_RECAP_VIDEO=1, and
// then only from the recap's own published moments. With the flag off the
// page renders as it did before the video existed.

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RecapVideoInput } from "@/lib/recapVideo";

const STORY_ID = "0b6d6f4e-3f6f-4d0a-9d2e-3c1f0d2a5b7c";
const seen = vi.hoisted(() => ({ input: null as RecapVideoInput | null }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/plan/RecapShareButton", () => ({ default: () => null }));
vi.mock("@/components/plan/RecapViewAnalytics", () => ({ default: () => null }));
vi.mock("@/components/recap/RecapVideoSection", () => ({
  default: ({ input }: { input: RecapVideoInput }) => {
    seen.input = input;
    return <div data-recap-video="" />;
  },
}));
vi.mock("@/lib/pintDropsStore", () => ({ pintDropsStore: () => ({ listVisible: async () => [] }) }));
vi.mock("@/lib/nightMomentMedia", () => ({
  PUBLIC_RECAP_PHOTO_TTL_SECONDS: 60,
  signedNightMomentPhotoUrl: async () => null,
}));
vi.mock("@/lib/venueDetailIndex", () => ({
  getVenueDetail: async (venueId: string) =>
    venueId === "v-lamb" ? { name: "The Lamb", latitude: 51.523, longitude: -0.118 } : null,
}));

const moment = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({
  id,
  memoryId: "mem1",
  ownerId: "owner-1",
  kind,
  caption: "",
  pintDropId: null,
  venueId: null,
  mediaObjectKey: null,
  occurredAt: null,
  visibility: "private",
  altText: null,
  altTextConfirmedAt: null,
  createdAt: "2026-07-17T19:00:00.000Z",
  ...extra,
});

vi.mock("@/lib/nightMemoryStore", () => ({
  readPublishedRecapSource: async () => ({
    status: "found",
    source: {
      story: {
        id: STORY_ID,
        title: "Soho, slowly",
        summary: "",
        status: "published",
        visibility: "public",
        legacyCrawlStoryId: null,
        // "secret" is not published, so its name must never reach the video.
        publishedMomentIds: ["stop", "friend"],
        publishedAt: "2026-07-18T09:00:00.000Z",
        createdAt: "2026-07-17T18:00:00.000Z",
        updatedAt: "2026-07-18T09:00:00.000Z",
      },
      moments: [
        moment("stop", "venue", { venueId: "v-lamb", occurredAt: "2026-07-17T19:40:00.000Z" }),
        moment("friend", "person", { caption: "Priya" }),
        moment("secret", "person", { caption: "Not published" }),
      ],
    },
  }),
}));

import PublicRecapPage from "@/app/recap/[storyId]/page";

async function renderPage(): Promise<string> {
  const element = await PublicRecapPage({ params: Promise.resolve({ storyId: STORY_ID }) });
  return renderToStaticMarkup(element);
}

afterEach(() => {
  vi.unstubAllEnvs();
  seen.input = null;
});

describe("the recap video on /recap/[storyId]", () => {
  it("is absent with the flag off", async () => {
    vi.stubEnv("PUBMAX_RECAP_VIDEO", "");
    const html = await renderPage();
    expect(html).toContain("Soho, slowly");
    expect(html).not.toContain("data-recap-video");
    expect(html).not.toContain("Watch the night back");
    expect(seen.input).toBeNull();
  });

  it("is built from the published moments only with the flag on", async () => {
    vi.stubEnv("PUBMAX_RECAP_VIDEO", "1");
    const html = await renderPage();
    expect(html).toContain("data-recap-video");
    expect(html).toContain("Watch the night back");
    expect(seen.input?.stops.map((stop) => [stop.venueName, stop.timeLabel])).toEqual([["The Lamb", "20:40"]]);
    expect(seen.input?.friends).toEqual(["Priya"]);
  });
});
