import type { Metadata } from "next";

import { buildDayGreeting } from "@/lib/dayGreeting";
import { dealDigestNote, digestSectionPicks } from "@/lib/dealsDigest";
import {
  buildWeatherBrief,
  toTonightPickDto,
  type WeatherBrief,
} from "@/lib/todayBrief";
import { hypedPubsForPage } from "@/lib/hypedPubs";
import { loadHypedPubs } from "@/lib/hypedPubs.server";
import { loadMapSelectableVenueIds } from "@/lib/mapEagerVenueIndex.server";
import { loadHistoricPubs } from "@/lib/historic";
import { LONDON_NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";
import { pickPubOfTheDay } from "@/lib/pubOfTheDay";
import { buildQuietPint } from "@/lib/quietPint";
import { formatConditionDate } from "@/lib/tonightConditions";
import { getPricedVenues } from "@/lib/venuePriceIndex";
import type { Venue } from "@/lib/venues";
import { loadFreshWeatherSnapshot } from "@/lib/weatherFreshness.server";
import {
  loadTodayOutAnswer,
  loadTodayWhatsOnAnswer,
  mergeTodayListingRows,
  todayPicksLaneReport,
  todayPicksReadStatus,
  whatsOnStatusForTonightListings,
} from "@/lib/todayListings.server";

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

export const runtime = "nodejs";

// THIS DOCUMENT IS PRERENDERED (captain 2026-09-05, "Widen", recorded in
// proxy.ts beside CDN_CACHED_DOCUMENT_PATHS): it drops the per-request CSP
// nonce so the Vercel CDN can hold it. Two rules follow, both enforced by
// `__tests__/cdnCachedDocuments.test.ts`:
//
//   1. Nothing per-request may be read here. `force-static` makes that a build
//      error rather than a silent per-request render, and it is also what stops
//      the root layout's nonce read (`headers()`) from pulling this route back
//      into dynamic rendering. The remembered area, the briefing-arrival marker
//      and the viewer's location are all read by the client after load.
//   2. Nothing personal may reach this document. One prerendered copy is handed
//      to every stranger, so the greeting names no one and the get-there strip
//      and the Tube card own their own client fetches.
export const dynamic = "force-static";
// The brief reads the current London day: the greeting's slot, the weather
// snapshot's staleness, tonight's listing window and the pub-of-the-day
// rotation all take `now`. Before 2026-09-05 that was the reason the page was
// rendered per request. It is now an ISR window instead: five minutes bounds
// how far a held copy can lag any of those readings (the weather read-through
// itself tolerates ninety), and the CDN regenerates in the background so no
// reader waits for the compose. Do not lengthen this to an hour: a greeting
// that says "morning" at ten past noon is the cost.
export const revalidate = 300;

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

  // These server reads run in parallel. Each read keeps its fail-soft result.
  const [weatherSnapshot, whatsOn, out, pricedVenues, historicPubs, hyped, mapSelectableVenueIds] = await Promise.all([
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
    loadHypedPubs(),
    loadMapSelectableVenueIds(),
  ]);

  const weather = buildWeatherBrief(weatherSnapshot, now);
  // The snapshot is London's, so only London's patches are asked. An area in
  // another city has no observation and belongs in no entry here.
  const weatherByArea = Object.fromEntries(
    LONDON_NIGHT_AREA_SLUGS.map((area) => [
      area,
      buildWeatherBrief(weatherSnapshot, now, area),
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
  // A lane that FAILED and a lane nobody ASKED are the same absence to a
  // reader, and neither is a quiet city (battle test M07).
  const picksLane = todayPicksLaneReport(whatsOnReadStatus, whatsOnRows.length, out);
  const picks = digestSectionPicks(listingRows, { limit: Number.POSITIVE_INFINITY }).map((pick) => {
    const dto = toTonightPickDto(pick.row);
    return pick.digest ? { ...dto, venueNote: dealDigestNote(pick.digest.venueCount) } : dto;
  });

  // Pub of the day, from the JOINED historic index rather than the raw
  // heritage cache: the join carries the venue id the card's map link needs,
  // and a name-keyed cache cannot tell two pubs of one name apart (Astra F08).
  // Every quality refusal lives in lib/pubOfTheDay; an empty eligible set is a
  // null card and the honest "still in the archive" state.
  const fact = pickPubOfTheDay(historicPubs, now);

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
              dateLabel: pub.dateLabel,
              listed: pub.listed,
            },
          ]
        : [],
    ),
    priceById,
    now,
  });

  const suggestedPubs = hypedPubsForPage(hyped.rows);
  const suggestedPubMapIds = mapSelectableVenueIds
    ? suggestedPubs.flatMap((pub) => pub.venueId && mapSelectableVenueIds.has(pub.venueId) ? [pub.venueId] : [])
    : null;

  // The greeting uses the server render's clock. Area personalisation reuses
  // that instant, so its time-of-day band agrees with the initial greeting.
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
      hypedPubs={suggestedPubs}
      mapSelectableVenueIds={suggestedPubMapIds}
      picksStatus={picksStatus}
      // The day the rows on screen were OBSERVED, never the instant this
      // request was served. Null when the read carries no source time, and the
      // card then prints no date rather than borrowing this render's.
      picksCheckedAt={whatsOn?.sourceObservedAt ?? null}
      picksReason={picksLane.reason}
      picksRetryable={picksLane.retryable}
      fact={fact}
      pintsIndex={pintsIndex}
      quietPint={quietPint}
    />
  );
}
