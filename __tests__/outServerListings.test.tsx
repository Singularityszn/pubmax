import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import OutClient from "@/app/out/OutClient";
import OutPage, { metadata } from "@/app/out/page";
import { GET } from "@/app/api/out/route";
import * as loadOut from "@/lib/out/loadOut";
import { isOutLimited } from "@/lib/outRateLimit";
import type { OutResponse } from "@/lib/out/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-vercel-forwarded-for": "192.0.2.126" }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const body: OutResponse = {
  status: "ready",
  listingsStatus: "ready",
  events: [{
    id: "fixture-event",
    venueId: "venue-fixture",
    kind: "event",
    placeName: "The Fixture Arms",
    startsAt: "2026-10-16T19:00:00Z",
    title: "Friday acoustic set",
    source: { label: "The Fixture Arms", url: "https://example.com/music" },
    observedAt: "2026-10-15T12:00:00Z",
    confidence: "listed",
  }],
  openPlans: [],
  attribution: [{ label: "The Fixture Arms", logoRequired: false, url: "https://example.com/music" }],
  observedAt: { "The Fixture Arms": "2026-10-15T12:00:00Z" },
  providers: [],
  venueMatch: "ready",
};

function documentFor(answer: OutResponse | null) {
  return renderToStaticMarkup(createElement(OutClient, {
    day: "tonight",
    initialAnswer: { city: "london", day: "today", body: answer, failed: answer === null },
  }));
}

describe("Out's server document", () => {
  it("contains sourced listings before JavaScript runs, while staying noindex", () => {
    const html = documentFor(body);
    expect(html).toContain("Friday acoustic set");
    expect(html).toContain("The Fixture Arms");
    expect(html).toContain("https://example.com/music");
    expect(html).not.toContain("Loading listings");
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBeUndefined();
  });

  it("reports a failed read without an indefinite loading placeholder", () => {
    const html = documentFor(null);
    expect(html).toContain("Could not check listings.");
    expect(html).not.toContain("Loading listings");
    expect(html).not.toContain("No listings for this day yet.");
  });

  it("shares the existing per-IP budget across the document, day chips and API", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T19:00:00Z"));
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("PUBMAX_E2E_RATE_LIMIT_MAX", "");
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");
    const providerRead = vi.spyOn(loadOut, "buildOutResponse").mockResolvedValue(body);
    const request = new Request("https://pubmaxxing.com/api/out", {
      headers: { "x-vercel-forwarded-for": "192.0.2.126" },
    });
    for (let i = 0; i < 59; i += 1) expect(await isOutLimited(request)).toBe(false);

    const allowed = renderToStaticMarkup(await OutPage({}));
    expect(allowed).toContain("Friday acoustic set");
    expect(providerRead).toHaveBeenCalledTimes(1);

    for (const day of ["today", "tomorrow", "weekend"]) {
      const html = renderToStaticMarkup(await OutPage({ searchParams: Promise.resolve({ day }) }));
      expect(html).toContain("Could not check listings.");
      expect(html).not.toContain("Friday acoustic set");
    }
    expect((await GET(request)).status).toBe(429);
    expect(providerRead).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_001);
    expect((await GET(request)).status).toBe(200);
    for (let i = 0; i < 59; i += 1) expect(await isOutLimited(request)).toBe(false);
    const limited = renderToStaticMarkup(await OutPage({}));
    expect(limited).toContain("Could not check listings.");
    expect(providerRead).toHaveBeenCalledTimes(2);
  });
});
