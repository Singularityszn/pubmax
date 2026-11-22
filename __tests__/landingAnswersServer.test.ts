import type { WhatsOnRow } from "@/lib/whatsOn";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const snapshotBox: { value: unknown } = { value: null };

vi.mock("@/lib/weatherFreshness.server", () => ({
  loadFreshWeatherSnapshot: async () => snapshotBox.value,
}));

import { landingTonightAnswer } from "@/lib/landingAnswers";
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
      line: "Feels like 22°C, clear, 5% chance of rain, 6 mph wind.",
      measured: true,
    });
  });

  it("tells a reading that expires inside the hold as a last read", async () => {
    snapshotBox.value = snapshot("2026-07-25T18:00:00.000Z");
    const { today } = await loadLandingAnswers(NOW);
    expect(today).toMatchObject({
      line: "Last reading: feels like 22°C, clear, 5% chance of rain, 6 mph wind.",
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
  ])("dates the cached weather answer with London's day at %s", async (instant, stamp) => {
    const answer = await loadLandingAnswers(new Date(instant));
    expect(answer.today.stamp).toBe(stamp);
  });

  it("keeps a link without a dated listings claim in the hourly document", async () => {
    expect((await loadLandingAnswers(NOW)).tonight).toMatchObject({ measured: false, stamp: "" });
  });
});

describe("the live landing Tonight tile", () => {
  const whatsOnRows: WhatsOnRow[] = [];
  const now = Date.parse("2026-11-05T18:00:00.000Z");
  const out = {
    body: { status: "ready" as const, events: [], observedAt: {} },
    failed: false,
    pending: false,
  };
  const answer = () => landingTonightAnswer(whatsOnRows, "ready", out, now);
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

  it("includes a sourced pub gig from Tonight's secondary music list", () => {
    whatsOnRows.push(gig);
    expect(answer().line).toBe("1 pub event listed in London tonight.");
  });

  it("counts grouped quizzes at each pub and excludes recurring deals", () => {
    const quiz: WhatsOnRow = {
      ...gig, id: "quiz", kind: "quiz", title: "Pub quiz",
      source: { label: "Question One", url: "https://questionone.com/venues/example/" },
    };
    whatsOnRows.push(quiz);
    expect(answer().line).toBe("1 pub quiz listed in London tonight.");
    whatsOnRows.push({ ...quiz, id: "quiz-duplicate" });
    whatsOnRows.push({ ...quiz, id: "quiz-2", venueId: "venue-other", placeName: "The Other" }, deal);
    expect(answer().line)
      .toBe("2 pub quizzes listed in London tonight. See recurring deals.");
    whatsOnRows.push(gig);
    expect(answer().line).toBe("3 pub events listed in London tonight. See recurring deals.");
  });

  it("mentions a recurring deal separately from dated events", () => {
    whatsOnRows.push(deal);
    expect(answer().line)
      .toBe("No pub events listed for tonight. See recurring deals.");
  });

  it("omits expired deals and stale event checks", () => {
    whatsOnRows.push({ ...deal, endsAt: "2026-11-05T17:00:00.000Z" });
    whatsOnRows.push({ ...gig, observedAt: "2026-11-03T09:00:00.000Z" });
    expect(answer().line).toBe("No pub events listed for tonight.");
  });

  it("withdraws the count when the live read fails despite held rows", () => {
    expect(landingTonightAnswer([gig], "ready", { ...out, body: null, failed: true }, now))
      .toMatchObject({ measured: false, line: "Tonight's listings are unavailable right now." });
  });
});
