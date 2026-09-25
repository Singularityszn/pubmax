import "server-only";

import {
  todayAnswer,
  tonightAnswer,
  type LandingAnswers,
  type TodayWeatherFacts,
} from "@/lib/landingAnswers";
import { hypedPubsForPage } from "@/lib/hypedPubs";
import { loadHypedPubs } from "@/lib/hypedPubs.server";
import {
  loadTodayOutAnswer,
  loadTodayWhatsOnAnswer,
  mergeTodayListingRows,
  whatsOnStatusForTonightListings,
} from "@/lib/todayListings.server";
import { BRIEF_DEFAULT_AREA } from "@/lib/todayBrief";
import { loadFreshWeatherSnapshot } from "@/lib/weatherFreshness.server";
import { observationFacts } from "@/lib/weatherObservationCopy";
import { latestWeatherForArea } from "@/lib/weatherSnapshots";

// The reads behind the front door's two answer cards.
//
// Both come from the SAME lanes /today and /tonight read, so the landing can
// never promise a night the routes behind it do not have. The shaping of the
// two sentences is lib/landingAnswers.ts; this file only fetches and fails
// soft. The landing document is prerendered and revalidates hourly
// (app/page.tsx), so this runs at build and at most once an hour after that,
// and nothing here reads the viewer.

export type { LandingAnswers } from "@/lib/landingAnswers";

const LONDON_DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/London",
});

// app/page.tsx `revalidate`: how long one rendered copy of the front door is held.
const LANDING_HOLD_MS = 3_600_000;

/** Both cards, from one pass over the weather store and the listing lanes. */
export async function loadLandingAnswers(now: Date = new Date()): Promise<LandingAnswers> {
  const stamp = LONDON_DAY.format(now);
  const [weatherSnapshot, whatsOn, out, hyped] = await Promise.all([
    loadFreshWeatherSnapshot({ now }).catch(() => null),
    loadTodayWhatsOnAnswer(now.getTime()),
    loadTodayOutAnswer(now.getTime()),
    loadHypedPubs(),
  ]);

  // The document is held for an hour, so the sentence carries nothing that can
  // turn false inside it: no sunset, no day or night, no drink verdict (it reads
  // the sun: a garden at 18:30 is a terrace by 19:30) and no relative age. A
  // reading that expires inside the hold is already told as a last read.
  const read = latestWeatherForArea(weatherSnapshot, BRIEF_DEFAULT_AREA, now.getTime());
  const weather: TodayWeatherFacts | null = read
    ? observationFacts({
        observation: read.observation,
        nightArea: null,
        now,
        stale: read.stale || Date.parse(read.observation.expiresAt) <= now.getTime() + LANDING_HOLD_MS,
      })
    : null;

  const readStatus = whatsOn?.readStatus ?? "degraded";
  const rows = whatsOn?.rows ?? [];
  const unread = readStatus === "degraded" && out.failed;
  const count = unread
    ? 0
    : mergeTodayListingRows(
        rows,
        out,
        now.getTime(),
        whatsOnStatusForTonightListings(readStatus, rows.length),
      ).length;
  // Same page-limited pack /tonight renders, so the card cannot under-count
  // pubs the route will show with "Open on map".
  const hypedCount = unread ? 0 : hypedPubsForPage(hyped.rows).length;

  return {
    today: todayAnswer(weather, stamp),
    tonight: tonightAnswer({ unread, count, hypedCount }, stamp),
  };
}
