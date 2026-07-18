import type { Metadata } from "next";

import {
  buildWeatherBrief,
  pickPubOfTheDayFact,
  rankTonightPicks,
  toTonightPickDto,
} from "@/lib/todayBrief";
import { formatConditionDate } from "@/lib/tonightConditions";
import { loadWhatsOn } from "@/lib/whatsOnStore";
import heritageCache from "@/public/data/heritage_cache.json";
import weatherSnapshot from "@/public/data/weather/latest.json";

import TodayClient from "./TodayClient";

// The morning brief: one composed home surface for "before you go". Four stacked
// cards, all from data the app already sources. Per PRD Lane A
// (docs/UNIVERSAL_DAY0_PRD.md) this is the smallest excellent v1; the signed-in
// mobile-home redirect before 17:00 London is deliberately out of this PR.
//
// Cards 1, 2 and 4 are composed on the server from bundled, sourced data so the
// brief paints instantly and deterministically (no request-time network, no
// waterfalls). Card 3 (get there and home) is client-only: it needs the
// viewer's rough location and live TfL, so it lives in its own strip.

export const metadata: Metadata = {
  title: "Today in London · PUBMAXXING",
  description:
    "Your morning brief: is it a pint-in-the-garden day, tonight's top picks, how you'll get home, and one sourced pub fact.",
  alternates: { canonical: "/today" },
};

// The brief reads the current London day (weather staleness, tonight's window,
// the pub-of-the-day rotation), so it can never be statically cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function TodayPage() {
  const now = new Date();

  const weather = buildWeatherBrief(weatherSnapshot, now);

  // Baseline-only (fail-soft live disabled): the brief must be reliable and
  // instant, and the bundled listings are already sourced. Tonight's own page
  // still layers the live CityMCP enrichment on top.
  const whatsOn = await loadWhatsOn(
    { window: "tonight" },
    { now: now.getTime(), fetchLive: async () => [] },
  );
  const picks = rankTonightPicks(whatsOn.rows, 3).map(toTonightPickDto);

  const fact = pickPubOfTheDayFact(heritageCache, now);

  return (
    <TodayClient
      dateLabel={formatConditionDate(now)}
      weather={weather}
      picks={picks}
      fact={fact}
    />
  );
}
