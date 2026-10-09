import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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
    loadTodayWhatsOnAnswer: async () => null,
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
      line: "22°C feels like, clear, 5% chance of rain, 9 km/h wind.",
      measured: true,
    });
  });

  it("tells a reading that expires inside the hold as a last read", async () => {
    snapshotBox.value = snapshot("2026-07-25T18:00:00.000Z");
    const { today } = await loadLandingAnswers(NOW);
    expect(today).toMatchObject({
      line: "Last read of the sky: 22°C feels like, clear, 5% chance of rain, 9 km/h wind.",
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
});
