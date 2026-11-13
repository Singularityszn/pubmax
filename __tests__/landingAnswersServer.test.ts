import type { LoadWhatsOnResult } from "@/lib/whatsOnStore";
import type { WhatsOnRow } from "@/lib/whatsOn";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const whatsOnRows: WhatsOnRow[] = [];
const snapshotBox: { value: unknown } = { value: null };

vi.mock("@/lib/weatherFreshness.server", () => ({
  loadFreshWeatherSnapshot: async () => snapshotBox.value,
}));

vi.mock("@/lib/hypedPubs.server", () => ({
  loadHypedPubs: async () => ({ generatedAt: null, rows: [] }),
}));

vi.mock("@/lib/todayListings.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/todayListings.server")>();
  return {
    ...actual,
    loadTodayWhatsOnAnswer: async () => whatsOnRows.length > 0
      ? { rows: whatsOnRows, readStatus: "ready" } as LoadWhatsOnResult
      : null,
    loadTodayOutAnswer: async () => ({ body: null, failed: true, pending: false }),
  };
});

import { loadLandingAnswers } from "@/lib/landingAnswers.server";

// The front door is held for an hour (app/page.tsx revalidate), so its weather
// sentence must stay true for the whole hold, not only at the render instant.

const NOW = new Date("2026-07-25T17:30:00.000Z");

function snapshot(expiresAt: string) {
  const observedAt = "2026-07-25T06:00:00.000Z";
  return {
    version: 1,
    generatedAt: observedAt,
    observations: [
      {
        nightArea: "piccadilly-soho",
        observedAt,
        expiresAt,
        condition: "Clear",
        feelsLikeC: 22,
        precipitationProbabilityPct: 5,
        windKph: 9,
        source: {
          sourceUrl: "https://api.open-meteo.com/v1/forecast?x=1",
          publisher: "Open-Meteo",
          publishedAt: observedAt,
        },
      },
    ],
  };
}

describe("loadLandingAnswers weather tile", () => {
  beforeEach(() => {
    snapshotBox.value = null;
  });

  it("prints the facts with no sunset, day or night, verdict or age", async () => {
    snapshotBox.value = snapshot("2026-07-26T06:00:00.000Z");
    const { today } = await loadLandingAnswers(NOW);
    expect(today).toMatchObject({
      line: "Feels like 22°C, clear, 5% chance of rain, 9 km/h wind.",
      measured: true,
    });
  });

  it("tells a reading that expires inside the hold as a last read", async () => {
    snapshotBox.value = snapshot("2026-07-25T18:00:00.000Z");
    const { today } = await loadLandingAnswers(NOW);
    expect(today).toMatchObject({
      line: "Last reading: feels like 22°C, clear, 5% chance of rain, 9 km/h wind.",
      measured: false,
    });
  });

  it("says plainly when there is no reading at all", async () => {
    const { today } = await loadLandingAnswers(NOW);
    expect(today).toMatchObject({
      line: "We couldn't read today's London weather just now.",
      measured: false,
    });
  });

  it.each([
    ["2026-10-24T23:59:59+01:00", "Saturday 24 October"],
    ["2026-10-25T00:00:00+01:00", "Sunday 25 October"],
    ["2026-10-25T01:30:00+01:00", "Sunday 25 October"],
    ["2026-10-25T01:30:00+00:00", "Sunday 25 October"],
  ])("dates both completed answers with London's day at %s", async (instant, stamp) => {
    const answer = await loadLandingAnswers(new Date(instant));
    expect(answer.today.stamp).toBe(stamp);
    expect(answer.tonight.stamp).toBe(stamp);
  });
});

describe("loadLandingAnswers Tonight tile", () => {
  const now = new Date("2026-11-05T18:00:00.000Z");
  const gig: WhatsOnRow = {
    id: "gig", venueId: "venue-example", placeName: "The Example",
    kind: "music", title: "Live music", confidence: "listed",
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/example" },
    startsAt: "2026-11-05T20:00:00.000Z",
    observedAt: "2026-11-05T09:00:00.000Z",
  };
  const deal: WhatsOnRow = {
    ...gig, id: "deal-jdw-example", kind: "deal", title: "Curry Club",
    startsAt: "2026-11-05T11:30:00.000Z", endsAt: "2026-11-05T23:00:00.000Z",
  };

  beforeEach(() => { whatsOnRows.length = 0; });

  it("includes a sourced pub gig from Tonight's secondary music list", async () => {
    whatsOnRows.push(gig);
    expect((await loadLandingAnswers(now)).tonight.line).toBe("1 pub event listed in London tonight.");
  });

  it("names the events as pub quizzes only when every dated event is a quiz", async () => {
    const quiz: WhatsOnRow = {
      ...gig, id: "quiz", kind: "quiz", title: "Pub quiz",
      source: { label: "Question One", url: "https://questionone.com/venues/example/" },
    };
    whatsOnRows.push(quiz);
    expect((await loadLandingAnswers(now)).tonight.line).toBe("1 pub quiz listed in London tonight.");
    whatsOnRows.push({ ...quiz, id: "quiz-2", venueId: "venue-other", placeName: "The Other" }, deal);
    expect((await loadLandingAnswers(now)).tonight.line)
      .toBe("2 pub quizzes listed in London tonight. See recurring deals.");
    whatsOnRows.push(gig);
    expect((await loadLandingAnswers(now)).tonight.line).toBe("3 pub events listed in London tonight. See recurring deals.");
  });

  it("mentions a recurring deal separately from dated events", async () => {
    whatsOnRows.push(deal);
    expect((await loadLandingAnswers(now)).tonight.line)
      .toBe("No pub events listed for tonight. See recurring deals.");
  });

  it("omits expired deals and stale event checks", async () => {
    whatsOnRows.push({ ...deal, endsAt: "2026-11-05T17:00:00.000Z" });
    whatsOnRows.push({ ...gig, observedAt: "2026-11-03T09:00:00.000Z" });
    expect((await loadLandingAnswers(now)).tonight.line).toBe("No pub events listed for tonight.");
  });
});
