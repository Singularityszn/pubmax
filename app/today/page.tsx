import type { Metadata } from "next";

import { buildDayGreeting } from "@/lib/dayGreeting";
import { CENTRAL_PATCH } from "@/lib/nightPatches";
import { nearestNightPatch } from "@/lib/nearestNightPatch";
import { disruptionForPatch, fetchLineStatuses } from "@/lib/tflDisruption";
import { buildWeatherBrief, type WeatherBrief } from "@/lib/todayBrief";
import { loadHistoricPubs } from "@/lib/historic";
import { LONDON_NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";
import { pickPubOfTheDay } from "@/lib/pubOfTheDay";
import { buildQuietPint } from "@/lib/quietPint";
import { formatConditionDate } from "@/lib/tonightConditions";
import { getPricedVenues } from "@/lib/venuePriceIndex";
import type { Venue } from "@/lib/venues";
import { loadFreshWeatherSnapshot } from "@/lib/weatherFreshness.server";
import { loadVenueMenuEnrichmentIndex } from "@/lib/venueMenuEnrichment";

import TodayClient from "./TodayClient";
import {
  buildTodayCoffee,
  buildTodayLunchIndex,
  buildTodayWorkSpotsIndex,
  type TodayLunchIndex,
} from "./todayDaytime";
import { loadTodayCoffeePilot, loadTodayDeskPack } from "./todayDaytime.server";
import { buildTodayPintsIndex, type TodayPintsIndex } from "./todayPints";

// The daytime page: one composed surface for the day, a stack of sections all
// from data the app already sources. Since the launch review (30 Oct 2026,
// design V1) it carries none of Tonight's picks: work spots, coffee, lunch at a
// pub, a quiet pint, the weather and the cheap pints, with the pub of the day at
// the foot.
//
// Weather, the pub fact, the cheapest-pints index and the daytime modules are
// composed on the server, one small module per night patch, so the browser
// takes no venue data of its own. Independent reads run in parallel. The
// get-there strip needs the viewer's rough location, so it owns its own fetch.
// The Tube card starts with central London, then refreshes for the viewer's
// remembered area.

export const metadata: Metadata = {
  title: "Today in London",
  description:
    "Your day in London: work spots, a coffee, lunch at a pub, a quiet pint, the weather, how you'll get home, and one sourced pub fact.",
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
//      to every stranger, so the greeting names no one. Viewer-specific reads
//      stay in client components, including the Tube refresh.
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
const lunchIndexByVenues = new WeakMap<Venue[], TodayLunchIndex>();

function todayPintsIndexFor(venues: Venue[]): TodayPintsIndex {
  const held = pintsIndexByVenues.get(venues);
  if (held) return held;
  const built = buildTodayPintsIndex(venues);
  pintsIndexByVenues.set(venues, built);
  return built;
}

// The lunch rows join the dataset to the menu links, and neither moves within a
// process, so the join is held on the dataset's identity like the two above.
function todayLunchIndexFor(
  venues: Venue[],
  menus: Awaited<ReturnType<typeof loadVenueMenuEnrichmentIndex>>,
): TodayLunchIndex {
  const held = lunchIndexByVenues.get(venues);
  if (held) return held;
  const built = buildTodayLunchIndex(venues, menus);
  // An empty menu index is a read that may have failed: never hold it.
  if (menus.size > 0) lunchIndexByVenues.set(venues, built);
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
  const [weatherSnapshot, pricedVenues, historicPubs, menus, desks, coffeeRows, lineStatuses] = await Promise.all([
    // Store-first read-through: the freshest durable/cached reading when it is
    // recent, else a live Open-Meteo top-up (reusing the cron's fetcher), else
    // the committed snapshot with its honest staleness banner. Never needlessly
    // stale even between cron runs or before migration 0047 lands.
    loadFreshWeatherSnapshot({ now }),
    // Cheapest priced pints per area and the lunch pubs, both precomputed from
    // the bundled price dataset so the client answers the viewer's remembered
    // area with no venue data of its own and no request-time work.
    getPricedVenues(),
    loadHistoricPubs(),
    // The menu links a lunch row needs (the venue sheet's own overlay).
    loadVenueMenuEnrichmentIndex(),
    // The /near Work spots pack, read here so no reader downloads it.
    loadTodayDeskPack(),
    // The Shoreditch coffee pilot, hand-checked rows.
    loadTodayCoffeePilot(),
    // Central London's first Tube notice, so it is in the shared document.
    fetchLineStatuses(),
  ]);

  // The shared document starts with the same central-London patch as the client.
  // Live refresh still resolves the reader's remembered area after hydration.
  const centralPatch = nearestNightPatch(CENTRAL_PATCH.lat, CENTRAL_PATCH.lng);
  const initialDisruption = centralPatch
    ? disruptionForPatch(lineStatuses, centralPatch.id, now)
    : null;
  const weather = buildWeatherBrief(weatherSnapshot, now);
  // The snapshot is London's, so only London's patches are asked. An area in
  // another city has no observation and belongs in no entry here.
  const weatherByArea = Object.fromEntries(
    LONDON_NIGHT_AREA_SLUGS.map((area) => [
      area,
      buildWeatherBrief(weatherSnapshot, now, area),
    ]),
  ) as Partial<Record<NightAreaSlug, WeatherBrief | null>>;

  // The daytime modules. Each is fail-soft: a pack that could not be read
  // leaves its index empty, and an empty index renders no section.
  const workSpots = desks.status === "ready"
    ? buildTodayWorkSpotsIndex(desks.venues, desks.observedAt, now)
    : {};
  const lunch = todayLunchIndexFor(pricedVenues, menus);
  const coffee = buildTodayCoffee(coffeeRows, "Shoreditch");

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
      initialDisruption={initialDisruption}
      weatherByArea={weatherByArea}
      fact={fact}
      pintsIndex={pintsIndex}
      quietPint={quietPint}
      workSpots={workSpots}
      lunch={lunch}
      coffee={coffee}
    />
  );
}
