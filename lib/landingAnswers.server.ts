import "server-only";

import {
  todayAnswer,
  LANDING_TONIGHT_LINK,
  type LandingAnswers,
  type TodayWeatherFacts,
} from "@/lib/landingAnswers";
import { hypedPubsForPage } from "@/lib/hypedPubs";
import { loadHypedPubs } from "@/lib/hypedPubs.server";
import { BRIEF_DEFAULT_AREA } from "@/lib/todayBrief";
import { londonDayLabel } from "@/lib/londonHour";
import { loadFreshWeatherSnapshot } from "@/lib/weatherFreshness.server";
import { observationFacts } from "@/lib/weatherObservationCopy";
import { latestWeatherForArea } from "@/lib/weatherSnapshots";

export type { LandingAnswers } from "@/lib/landingAnswers";

// app/page.tsx `revalidate`: how long one rendered copy of the front door is held.
const LANDING_HOLD_MS = 3_600_000;

/** The hourly document gives Tonight a link. Its count waits for the live read. */
export async function loadLandingAnswers(now: Date = new Date()): Promise<LandingAnswers> {
  const stamp = londonDayLabel(now);
  const [weatherSnapshot, hyped] = await Promise.all([
    loadFreshWeatherSnapshot({ now }).catch(() => null),
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

  return {
    today: todayAnswer(weather, stamp),
    tonight: LANDING_TONIGHT_LINK,
    hypedCount: hypedPubsForPage(hyped.rows, { now }).length,
  };
}
