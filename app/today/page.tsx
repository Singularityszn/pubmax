import type { Metadata } from "next";

import { dealDigestNote, digestSectionPicks } from "@/lib/dealsDigest";
import {
  buildWeatherBrief,
  pickPubOfTheDayFact,
  toTonightPickDto,
} from "@/lib/todayBrief";
import { loadHistoricPubs } from "@/lib/historic";
import { buildQuietPint } from "@/lib/quietPint";
import { formatConditionDate } from "@/lib/tonightConditions";
import { getPricedVenues } from "@/lib/venuePriceIndex";
import { loadFreshWeatherSnapshot } from "@/lib/weatherFreshness.server";
import { loadWhatsOn } from "@/lib/whatsOnStore";
import heritageCache from "@/public/data/heritage_cache.json";

import TodayClient from "./TodayClient";
import { buildTodayPintsIndex } from "./todayPints";

// The morning brief: one composed home surface for "before you go", a stack of
// cards all from data the app already sources. Per PRD Lane A
// (docs/UNIVERSAL_DAY0_PRD.md) this is the smallest excellent v1; the signed-in
// mobile-home redirect before 17:00 London is deliberately out of this PR.
//
// The weather, tonight's picks, the pub fact and the cheapest-pints index are
// composed on the server from bundled, sourced data so the brief paints instantly
// and deterministically (no request-time network, no waterfalls). The get-there
// strip and the Tube card are client-only: they need the viewer's rough location
// or remembered area and live TfL, so they own their own fetches.

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

  // Store-first read-through: the freshest durable/cached reading when it is
  // recent, else a live Open-Meteo top-up (reusing the cron's fetcher), else the
  // committed snapshot with its honest staleness banner. Guarantees the card is
  // never needlessly stale even between cron runs or before migration 0047 lands.
  const weather = buildWeatherBrief(await loadFreshWeatherSnapshot({ now }), now);

  // Baseline-only (fail-soft live disabled): the brief must be reliable and
  // instant, and the bundled listings are already sourced. Tonight's own page
  // still layers the live CityMCP enrichment on top.
  const whatsOn = await loadWhatsOn(
    { window: "tonight" },
    { now: now.getTime(), fetchLive: async () => [] },
  );
  // Group syndicated chain deals (identical title + source across venues) into
  // one pick carrying the real venue count, cap to one card per source, and take
  // the top 3. Fixes the live-taste P0 where one Wetherspoon promotion filled the
  // section with five identical cards. No location on the server, so the digest
  // resolves each group's display to its soonest venue; the client re-orders the
  // resulting picks around the viewer's remembered patch below.
  const picks = digestSectionPicks(whatsOn.rows, { limit: 3 }).map((pick) => {
    const dto = toTonightPickDto(pick.row);
    return pick.digest ? { ...dto, venueNote: dealDigestNote(pick.digest.venueCount) } : dto;
  });

  const fact = pickPubOfTheDayFact(heritageCache, now);

  // Cheapest priced pints per area, precomputed from the bundled price dataset so
  // the client can answer the viewer's remembered area with no venue data of its
  // own and no request-time work.
  const pricedVenues = await getPricedVenues();
  const pintsIndex = buildTodayPintsIndex(pricedVenues);

  // "A quiet pint" — heritage-cited pubs that also read as quiet at this hour,
  // for the calmer 45-60 cohort. Ranked server-side from the cited historic-pub
  // set, joined to verified pint prices by venue id. Fail-soft to null (a busy
  // hour, or no cited candidates), and the card then renders nothing.
  const priceById = new Map<string, number>();
  for (const venue of pricedVenues) {
    if (typeof venue.cheapestPrice === "number") priceById.set(venue.id, venue.cheapestPrice);
  }
  const historicPubs = await loadHistoricPubs();
  const quietPint = buildQuietPint({
    candidates: historicPubs.flatMap((pub) =>
      pub.venueId
        ? [
            {
              venueId: pub.venueId,
              name: pub.name,
              slug: pub.slug,
              hook: pub.hook,
              facts: pub.facts,
              era: pub.era,
              listed: pub.listed,
            },
          ]
        : [],
    ),
    priceById,
    now,
  });

  return (
    <TodayClient
      dateLabel={formatConditionDate(now)}
      weather={weather}
      picks={picks}
      fact={fact}
      pintsIndex={pintsIndex}
      quietPint={quietPint}
    />
  );
}
