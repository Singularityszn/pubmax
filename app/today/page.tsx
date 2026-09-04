import type { Metadata } from "next";

import { buildDayGreeting } from "@/lib/dayGreeting";
import { dealDigestNote, digestSectionPicks } from "@/lib/dealsDigest";
import {
  buildWeatherBrief,
  pickPubOfTheDayFact,
  toTonightPickDto,
  type WeatherBrief,
} from "@/lib/todayBrief";
import { loadHistoricPubs } from "@/lib/historic";
import { NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";
import { buildQuietPint } from "@/lib/quietPint";
import { formatConditionDate } from "@/lib/tonightConditions";
import { getPricedVenues } from "@/lib/venuePriceIndex";
import type { Venue } from "@/lib/venues";
import { loadFreshWeatherSnapshot } from "@/lib/weatherFreshness.server";
import {
  loadTodayOutAnswer,
  loadTodayWhatsOnAnswer,
  mergeTodayListingRows,
  todayPicksReadStatus,
  whatsOnStatusForTonightListings,
} from "@/lib/todayListings.server";
import heritageCache from "@/public/data/heritage_cache.json";

import TodayClient from "./TodayClient";
import { buildTodayPintsIndex, type TodayPintsIndex } from "./todayPints";

// The morning brief: one composed home surface for "before you go", a stack of
// cards all from data the app already sources. Per PRD Lane A
// (docs/UNIVERSAL_DAY0_PRD.md) this is the smallest excellent v1; the signed-in
// mobile-home redirect before 17:00 London is deliberately out of this PR.
//
// Weather, the pub fact and the cheapest-pints index are bundled on the server.
// Tonight's picks use the same merged What's-On plus Out spine as /tonight
// (lib/todayListings.server.ts). Independent reads still run in parallel. The
// get-there strip and the Tube card are client-only: they need the viewer's rough
// location or remembered area and live TfL, so they own their own fetches.

export const metadata: Metadata = {
  title: "Today in London · PUBMAXXING",
  description:
    "Your morning brief: is it a pint-in-the-garden day, tonight's top picks, how you'll get home, and one sourced pub fact.",
  alternates: { canonical: "/today" },
};

// The brief reads the current London day (weather staleness, tonight's window,
// the pub-of-the-day rotation), so it must never be statically cached. Dynamic
// rendering is already guaranteed by the root layout's per-request `headers()`
// (the CSP nonce), which opts every route into dynamic rendering — so an
// explicit `force-dynamic` here is redundant and has been removed. (If the
// layout's nonce read is ever removed, restore force-dynamic to keep /today
// from being statically cached with stale weather.)
export const runtime = "nodejs";

// Two derivations over the bundled price dataset that are the SAME for every
// reader and every request: the per-patch cheapest-pint index, and the venue-id
// to price map the quiet-pint ranking joins on. `getPricedVenues()` memoises the
// 6.7 MB parse and hands back the very same array for the life of the process,
// so both are keyed on that array's IDENTITY. A WeakMap rather than a plain
// module variable is the point: nothing has to remember to invalidate, because a
// dataset that was re-read is a different array and derives afresh, which is
// also what `resetVenuePriceIndexForTests` gives a test for free.
//
// Neither derivation reads the clock, the request, or anything about a viewer,
// so this can never hold one reader's answer in front of another.
const pintsIndexByVenues = new WeakMap<Venue[], TodayPintsIndex>();
const priceByIdByVenues = new WeakMap<Venue[], Map<string, number>>();

function todayPintsIndexFor(venues: Venue[]): TodayPintsIndex {
  const held = pintsIndexByVenues.get(venues);
  if (held) return held;
  const built = buildTodayPintsIndex(venues);
  pintsIndexByVenues.set(venues, built);
  return built;
}

function pricedVenuePriceById(venues: Venue[]): Map<string, number> {
  const held = priceByIdByVenues.get(venues);
  if (held) return held;
  const built = new Map<string, number>();
  for (const venue of venues) {
    if (typeof venue.cheapestPrice === "number") built.set(venue.id, venue.cheapestPrice);
  }
  priceByIdByVenues.set(venues, built);
  return built;
}

export default async function TodayPage() {
  const now = new Date();

  // The four server reads below are independent — none consumes another's
  // result — so they run concurrently. Serialising them stacked a live
  // Open-Meteo weather top-up behind the listings, price, and heritage reads for
  // no reason; Promise.all collapses the brief's server render to the slowest
  // single read. Each retains its own fail-soft path.
  const [weatherSnapshot, whatsOn, out, pricedVenues, historicPubs] = await Promise.all([
    // Store-first read-through: the freshest durable/cached reading when it is
    // recent, else a live Open-Meteo top-up (reusing the cron's fetcher), else
    // the committed snapshot with its honest staleness banner. Never needlessly
    // stale even between cron runs or before migration 0047 lands.
    loadFreshWeatherSnapshot({ now }),
    // Same bundled-plus-live spine as /api/whats-on; Out events merge below.
    loadTodayWhatsOnAnswer(now.getTime()),
    loadTodayOutAnswer(now.getTime()),
    // Cheapest priced pints per area, precomputed from the bundled price dataset
    // so the client can answer the viewer's remembered area with no venue data
    // of its own and no request-time work.
    getPricedVenues(),
    loadHistoricPubs(),
  ]);

  const weather = buildWeatherBrief(weatherSnapshot, now);
  const weatherByArea = Object.fromEntries(
    NIGHT_AREA_SLUGS.map((area) => [
      area,
      buildWeatherBrief(weatherSnapshot, now, area, { fallbackToFirst: false }),
    ]),
  ) as Partial<Record<NightAreaSlug, WeatherBrief | null>>;

  // Group syndicated chain deals (identical title + source across venues) into
  // one pick carrying the real venue count and cap to one card per source. Keep
  // the ranked candidate set uncapped until the client applies evidenced mutes,
  // then Today takes its top 3. Fixes the live-taste P0 where one Wetherspoon promotion filled the
  // section with five identical cards. No location on the server, so the digest
  // resolves each group's display to its soonest venue; the client re-orders the
  // resulting picks around the viewer's remembered patch below.
  // Same merged spine as /tonight: bundled What's-On rows plus Out events.
  const whatsOnReadStatus = whatsOn?.readStatus ?? "degraded";
  const whatsOnRows = whatsOn?.rows ?? [];
  const whatsOnStatus = whatsOnStatusForTonightListings(
    whatsOnReadStatus,
    whatsOnRows.length,
  );
  const listingRows = mergeTodayListingRows(
    whatsOnRows,
    out,
    now.getTime(),
    whatsOnStatus,
  );
  const picksStatus = todayPicksReadStatus(
    whatsOnReadStatus,
    whatsOnRows.length,
    out,
    now.getTime(),
    whatsOnRows,
  );
  const picks = digestSectionPicks(listingRows, { limit: Number.POSITIVE_INFINITY }).map((pick) => {
    const dto = toTonightPickDto(pick.row);
    return pick.digest ? { ...dto, venueNote: dealDigestNote(pick.digest.venueCount) } : dto;
  });

  const fact = pickPubOfTheDayFact(heritageCache, now);

  const pintsIndex = todayPintsIndexFor(pricedVenues);

  // "A quiet pint" — heritage-cited pubs that also read as quiet at this hour,
  // for the calmer 45-60 cohort. Ranked server-side from the cited historic-pub
  // set, joined to verified pint prices by venue id. Fail-soft to null (a busy
  // hour, or no cited candidates), and the card then renders nothing.
  const priceById = pricedVenuePriceById(pricedVenues);
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

  // The personal line at the top. Composed here from the server's `now` (the
  // route is dynamic per request, so it is genuinely current) and handed down
  // whole, so the first paint already carries the right time of day and the
  // right sky. The client rebuilds it only when personalization swaps the
  // viewer's area weather in, reusing this same instant so the time-of-day band
  // can never drift away from what was server rendered.
  const dateLabel = formatConditionDate(now);
  const greeting = buildDayGreeting({ now, weather, dateLabel });

  return (
    <TodayClient
      dateLabel={dateLabel}
      nowIso={now.toISOString()}
      greeting={greeting}
      weather={weather}
      weatherByArea={weatherByArea}
      picks={picks}
      picksStatus={picksStatus}
      fact={fact}
      pintsIndex={pintsIndex}
      quietPint={quietPint}
    />
  );
}
