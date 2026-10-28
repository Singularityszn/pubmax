"use client";

// The morning brief surface (/today). A personal greeting over a stack of
// cards, mobile-first, both themes via role tokens. Most cards render from
// server-composed props (lib/todayBrief.ts); the Tube and get-there cards own
// their own location + live TfL. Every sourced claim carries its attribution,
// and every card has an honest empty/stale state rather than filler.
//
// Anything that names a time of day (the greeting, the Tube eyebrow, the picks
// empty state) takes its band from lib/dayGreeting.ts rather than hardcoding
// one, so the page never greets a viewer with somebody else's hour. No em
// dashes in any copy.
//
// Two arrows, and they mean two different things. `ExternalLink` rides a link
// that leaves the site; `ArrowRight` rides one that stays on it. Every internal
// link here used to carry the diagonal `ArrowUpRight`, which is the glyph a
// reader has learnt means "this opens somewhere else" - so "See everything on
// tonight", a link to /tonight, promised a new tab it never opened.

import Link from "next/link";
import { ArrowRight, ExternalLink, MapPin } from "lucide-react";

import { useEffect, useState, useSyncExternalStore } from "react";
import { formatConditionDate } from "@/lib/tonightConditions";

import NowSegment from "@/components/nav/NowSegment";
import SiteNav from "@/components/nav/SiteNav";
import PriceBadge from "@/components/PriceBadge";
import Screen from "@/components/ui/screen";
import PreparedBriefStamp from "@/components/seo/PreparedBriefStamp";
import {
  buildDayGreeting,
  picksCardStatus,
  picksListLine,
  type DayGreeting,
  type DaySlot,
  type PicksListReadStatus,
} from "@/lib/dayGreeting";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import PicksAlternatives from "@/components/picks/PicksAlternatives";
import { useLoopMoment } from "@/components/loop/useLoopMoment";
import { arrivedFromBriefingPush } from "@/lib/briefingArrival";
import type { NightAreaSlug } from "@/lib/nightAreas";
import {
  NIGHT_PATCHES,
  readRememberedArea,
  rememberedPatchId,
} from "@/lib/nightPatches";
import {
  PICKS_REFRESHING_LINE,
  picksCheckedLabel,
  picksState,
  picksStateOffersAlternative,
  picksStateShowsRows,
  type PicksContext,
} from "@/lib/picksState";
import { parsePlanOccasionIdFromSearch } from "@/lib/planOccasion";
import { PLAN_INTAKE_STORAGE_KEY, parsePlanIntakeDraft } from "@/lib/planIntake";
import { resolveTonightNear } from "@/lib/tonight";
import { orderPicksNear, type TonightPickDto, type WeatherBrief } from "@/lib/todayBrief";
import type { PubOfTheDayCard } from "@/lib/pubOfTheDay";
import {
  applyTodayPersonalization,
  resolveTodayPersonalization,
} from "@/lib/todayPersonalization";

import TodayGetThereStrip from "./TodayGetThereStrip";
import TodayPintsCard from "./TodayPintsCard";
import TodayQuietPintCard from "./TodayQuietPintCard";
import TodayTubeCard from "./TodayTubeCard";
import { TODAY_TEXT_BUTTON_CLASS } from "./todayTextButton";
import type { TodayPintsIndex } from "./todayPints";
import type { QuietPintModule } from "@/lib/quietPint";
import TonightHypedPubs from "../tonight/TonightHypedPubs";
import type { HypedPub } from "@/lib/hypedPubs";
import type { PatchDisruption } from "@/lib/tflDisruption";
import "../tonight/tonightLede.css";
import "./today.css";

type Props = {
  dateLabel: string;
  /** The server instant used for the first render before the client clock is available. */
  nowIso: string;
  greeting: DayGreeting;
  weather: WeatherBrief | null;
  initialDisruption?: PatchDisruption | null;
  weatherByArea: Partial<Record<NightAreaSlug, WeatherBrief | null>>;
  picks: TonightPickDto[];
  hypedPubs?: readonly HypedPub[];
  mapSelectableVenueIds?: readonly string[] | null;
  picksStatus: PicksListReadStatus;
  /** When the rows behind the picks were OBSERVED, not when this page was served. */
  picksCheckedAt?: string | null;
  /**
   * A lane's own line for why it is not carrying its share, else null.
   *
   * Covers a lane that FAILED and a lane NOBODY ASKED alike: both are an
   * absence about us, and neither may be worded as a quiet city (battle test
   * M07, where an unconfigured listings lane printed "Nothing on tonight's
   * list yet.").
   */
  picksReason?: string | null;
  /** False for a lane nobody switched on: asking it again changes nothing. */
  picksRetryable?: boolean;
  fact: PubOfTheDayCard | null;
  pintsIndex: TodayPintsIndex;
  quietPint: QuietPintModule | null;
};

// The drink weather, as ONE line of the page: the verdict is the section's
// heading and the reading's own facts are the line under it. The headline
// above no longer restates the sky (taste plan, 18 Oct 2026: the H1 said
// "Cold out. Fireplace weather." over a card that said "Stout weather."), so
// this is the one place on the page the weather is said. No reading, no
// section: an empty weather box is a section that opens with an empty state.
function WeatherCard({ weather }: { weather: WeatherBrief | null }) {
  if (!weather) return null;
  const title =
    weather.verdictLine || (weather.stale ? "Last weather reading on file." : "The weather tonight.");
  return (
    <section className="todayCard createFabLane" aria-labelledby="today-weather-title" data-testid="today-weather">
      <h2 className="todayCardTitle" id="today-weather-title">
        {title}
      </h2>
      {weather.stale ? (
        <p className="todayStale" role="status">
          {weather.checkedLabel}. Conditions may have changed.
        </p>
      ) : null}
      {/* The facts and their source in one line. The day is printed ONCE: a
          stale card already says it above, so its line keeps the credit. */}
      <p className="todayCardLine">
        {weather.factsLine ? `${weather.factsLine} ` : null}
        {weather.stale ? null : `${weather.checkedLabel}, `}
        via{" "}
        <a
          className="todayProvenanceLink"
          href={weather.source.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          {weather.source.publisher}
        </a>
        .
      </p>
    </section>
  );
}

// ONE FIGURE, ONE PLACE, DATED. This card used to lead with the cheapest listed
// pint as well, off `rows[0]` of the very module `TodayPintsCard` prints below
// it, so the page showed one pub's price twice and dated it once: only the
// pints card carries a snapshot date (the oldest read among its rows). The
// dated copy is the one that stayed (#1426 follow-up).
function PicksCard({
  picks,
  filteredPickCount,
  slot,
  picksStatus,
  picksCheckedAt,
  picksReason,
  picksRetryable,
  context,
  hypedPubs,
  selectableVenueIds,
}: {
  picks: TonightPickDto[];
  filteredPickCount: number;
  slot: DaySlot;
  picksStatus: PicksListReadStatus;
  picksCheckedAt: string | null;
  picksReason: string | null;
  picksRetryable: boolean;
  context: PicksContext;
  hypedPubs: readonly HypedPub[];
  selectableVenueIds: ReadonlySet<string> | null;
}) {
  // ONE state, the same four words /tonight reads (lib/picksState.ts). Today's
  // picks are composed on the SERVER and never re-read from the browser, so
  // `inFlight` is honestly false here and `refreshing` is unreachable on this
  // surface. It stays in the vocabulary because the renderer is built against
  // the whole of it rather than retrofitted the day a client read lands.
  //
  // Listings the viewer filtered out still mean the read ANSWERED, so they
  // count towards ready exactly as they did before.
  const state = picksState({
    visibleCount: picks.length + filteredPickCount,
    inFlight: false,
    // A lane that failed and a lane nobody asked are one absence here, and
    // neither is a quiet city.
    unreadable: picksStatus === "degraded" || picksReason !== null,
    reason: picksReason,
    retryable: picksRetryable,
    checkedAt: picksCheckedAt,
  });
  const checked = picksCheckedLabel(state.checkedAt);
  if (picks.length === 0 && filteredPickCount === 0 && hypedPubs.length > 0) {
    return (
      <section
        className="todayPicksFallback"
        aria-labelledby="today-picks-title"
        data-testid="today-picks"
        data-picks-state={state.kind}
      >
        <h2 className="todayCardTitle" id="today-picks-title">
          Top picks for tonight.
        </h2>
        <TonightHypedPubs rows={hypedPubs} selectableVenueIds={selectableVenueIds} nested />
        <p className="todayCardEmpty">
          {state.reason ?? (picksStatus === "degraded" ? picksListLine(picksStatus, slot) : "No confirmed events listed tonight.")}
        </p>
        <p className="todayCardFootRow">
          <Link prefetch={false} href="/tonight" className="todayInkLink">
            See everything on tonight
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </p>
      </section>
    );
  }
  return (
    <section
      className="todayCard"
      aria-labelledby="today-picks-title"
      data-testid="today-picks"
      data-picks-status={picksCardStatus(picksStatus, picks.length, filteredPickCount)}
      data-picks-state={state.kind}
    >
      <h2 className="todayCardTitle" id="today-picks-title">
        Top picks for tonight.
      </h2>

      {picksStateShowsRows(state, picks.length) ? (
        <>
          <ul className="todayPicks">
            {picks.map((pick) => {
              const inner = (
                <>
                  <div className="todayPickMeta">
                    <span className="todayPickKind" data-kind={pick.kind}>
                      {pick.kindLabel}
                    </span>
                    {/* A deal's figure, not a pint's, so the badge stays
                        neutral: a band is a claim about a pint alone. */}
                    {pick.priceGbp !== null ? (
                      <PriceBadge className="todayPickPrice">£{pick.priceGbp.toFixed(2)}</PriceBadge>
                    ) : null}
                  </div>
                  <h3 className="todayPickTitle">{pick.title}</h3>
                  <p className="todayPickPlace">
                    <MapPin size={14} aria-hidden="true" />
                    <span>{pick.placeName}</span>
                  </p>
                  {pick.venueNote ? (
                    <span className="todayPickDigest">{pick.venueNote}</span>
                  ) : null}
                  <span className="todayPickSource">via {pick.sourceLabel}</span>
                </>
              );
              return (
                <li key={pick.id} className="todayPick" data-kind={pick.kind}>
                  {pick.href ? (
                    pick.external ? (
                      <a
                        className="todayPickLink pressable"
                        href={pick.href}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {inner}
                        <ExternalLink size={14} aria-hidden="true" className="todayPickArrow" />
                      </a>
                    ) : (
                      <Link prefetch={false} className="todayPickLink pressable" href={pick.href}>
                        {inner}
                        <ArrowRight size={14} aria-hidden="true" className="todayPickArrow" />
                      </Link>
                    )
                  ) : (
                    <div className="todayPickLink">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="todayCardFootRow">
            <Link prefetch={false} href="/tonight" className="todayInkLink">
              See everything on tonight
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
            {state.kind === "refreshing" ? (
              <span className="todayPickChecked" data-testid="today-picks-checked">
                {PICKS_REFRESHING_LINE}
                {checked ? ` ${checked}.` : ""}
              </span>
            ) : null}
          </p>
        </>
      ) : (
        <>
          {/* A read we could not run says what happened to US. It may never be
              swapped for the quiet-night line, because we did not look. */}
          <p className="todayCardEmpty">
            {filteredPickCount > 0
              ? "Tonight has listings, but none match the filters you've set."
              : (state.reason ?? picksListLine(picksStatus, slot))}
          </p>
          {/* The compose action floats over this card's right cell on a phone,
              and this row's arrow lands in it, so the row takes the control's
              own lane (createFab.css). */}
          <p className="todayCardFootRow createFabLane">
            <Link prefetch={false} href="/map" className="todayInkLink">
              Meanwhile, the map knows the cheap pints
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </p>
          {/* Nothing here is a dead end: two doors that are honestly not
              listings, carrying the area and occasion the reader already chose. */}
          {picksStateOffersAlternative(state) ? (
            <PicksAlternatives context={context} />
          ) : null}
        </>
      )}
    </section>
  );
}

/** Read and validate the resumable Plan intake without cleaning up its storage. */
function readPlanIntakeDraftReadonly() {
  if (typeof window === "undefined") return null;
  try {
    return parsePlanIntakeDraft(window.localStorage.getItem(PLAN_INTAKE_STORAGE_KEY));
  } catch {
    return null;
  }
}

// The daily editorial section. What may fill it is lib/pubOfTheDay's decision,
// never this component's. No card, no section: a heading over "still in the
// archive" is a section that opens with an empty state, so a day without a
// card simply goes without. The ONE action is internal, because a pub of the
// day a reader cannot open is a magazine page (Astra F08), and it is a
// secondary on the neutral control surface: the page's coral is its primary.
function FactCard({ fact }: { fact: PubOfTheDayCard | null }) {
  if (!fact) return null;
  return (
    <section className="todayCard" aria-labelledby="today-fact-title" data-testid="today-fact">
      <h2 className="todayCardTitle" id="today-fact-title">
        Pub of the day: {fact.pubName}
      </h2>
      <p className="todayCardBody">{fact.reason}</p>
      <Link className="todayButton" href={fact.mapHref} prefetch={false}>
        <MapPin size={16} aria-hidden="true" />
        Open it on the map
      </Link>
      <div className="todayCardFootRow">
        <span className="todayProvChip" data-provenance={fact.provenance}>
          {fact.provenanceLabel}
        </span>
        {fact.sourceRef ? (
          <a
            className={TODAY_TEXT_BUTTON_CLASS}
            href={fact.sourceRef}
            target="_blank"
            rel="noreferrer noopener"
          >
            via {fact.sourceLabel}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        ) : (
          <span className="todayProvenance">via {fact.sourceLabel}</span>
        )}
      </div>
    </section>
  );
}

/** The /today heading, from docs/design/LAUNCH_SCREENS.md. */
const TODAY_HEADING = "What’s on across London today.";

/** What the morning brief turned out to be for this reader. */
type BriefShape = { personalized: boolean; muted: boolean };

function readTodayMinute(): number {
  return Math.floor(Date.now() / 60_000) * 60_000;
}

function serverTodayMinute(): null {
  return null;
}

function subscribeTodayClock(onChange: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === "visible") onChange();
  };
  const timer = window.setInterval(onVisible, 60_000);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export default function TodayClient({
  dateLabel,
  nowIso,
  greeting,
  weather,
  weatherByArea,
  initialDisruption = null,
  picks,
  picksStatus,
  hypedPubs = [],
  mapSelectableVenueIds = null,
  picksCheckedAt = null,
  picksReason = null,
  picksRetryable = true,
  fact,
  pintsIndex,
  quietPint,
}: Props) {
  const [brief, setBrief] = useState({ weather, picks: picks.slice(0, 3), filteredPickCount: 0 });
  // What the brief turned out to be, once the deferred personalization pass has
  // run. Null means "not resolved yet", so the impression is never reported off
  // a state the reader has not been shown.
  const [briefShape, setBriefShape] = useState<BriefShape | null>(null);
  // Did this arrival come from the daily-brief notification's own landing?
  // Read after mount, because the server has no reader's URL to read.
  const [openedFromBrief, setOpenedFromBrief] = useState(false);
  // What a fallback door out of an empty picks card must not drop: the area the
  // viewer last chose anywhere in the app, and the occasion they arrived with.
  // Both are read in the deferred pass below, so the first paint matches SSR.
  const [picksContext, setPicksContext] = useState<PicksContext>({});

  // Who the salutation may name. SSR and hydration both see nobody, then the
  // live session answers. Nothing about the layout depends on it, so its
  // arrival only ever appends a name — and a name it is not yet sure of is the
  // one thing it must never append (components/auth/useViewerHandle.ts).
  const deviceHandle = useViewerHandle() ?? "";

  // Preserve the server text for hydration, then read the current London day.
  // An ISR document can be older than the reader's time band.
  const clientMinute = useSyncExternalStore(subscribeTodayClock, readTodayMinute, serverTodayMinute);
  const shownNow = clientMinute === null ? new Date(nowIso) : new Date(clientMinute);
  const shownDateLabel = clientMinute === null ? dateLabel : formatConditionDate(shownNow);
  const shownGreeting = clientMinute === null && brief.weather === weather && !deviceHandle
    ? greeting
    : buildDayGreeting({
        now: shownNow,
        weather: brief.weather,
        dateLabel: shownDateLabel,
        name: deviceHandle,
      });

  // The brief was on screen, and what it turned out to be. Both props are
  // booleans on purpose: WHICH area or topic a reader mutes is a small set that
  // names their own patch, so only whether anything was muted travels.
  useLoopMoment(
    "briefing_viewed",
    briefShape ? `${briefShape.personalized}:${briefShape.muted}` : null,
    briefShape ?? undefined,
  );
  // A strict subset of the impression above, on the same page: the brief was
  // reached from the brief. No props - the closed name is the whole signal.
  useLoopMoment("briefing_opened", openedFromBrief ? "push" : null);

  // Silent continuity (#427 seam), now resolved field-by-field. The progressive
  // intake is the only newly consumed source in this UI wave. Account and
  // device Night Profiles stay pure resolver inputs until their owning account
  // lane provides an approved read contract. localStorage remains effect-only
  // so the first paint matches SSR.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const remembered = readRememberedArea();
      const rememberedPatch = NIGHT_PATCHES.find(
        (patch) => patch.id === rememberedPatchId(remembered),
      )?.id ?? null;
      setPicksContext({
        patchId: rememberedPatch,
        occasion: parsePlanOccasionIdFromSearch(window.location.search),
      });
      // The same deferred pass reads the address once: whether this arrival
      // carried the daily brief's own landing marker.
      setOpenedFromBrief(arrivedFromBriefingPush(window.location.search));
      const resolved = resolveTodayPersonalization({
        progressiveIntake: readPlanIntakeDraftReadonly(),
        reviewedDevice: null,
        defaults: rememberedPatch ? { preferredPatch: rememberedPatch } : null,
      });
      const personalized = applyTodayPersonalization(
        { weather, picks, filteredPickCount: 0 },
        weatherByArea,
        resolved,
      );
      // Preserve the existing borough-memory behavior for the no-profile path.
      // Modelled profile/intake fields take precedence and never consult it.
      const near = !resolved.personalized
        ? resolveTonightNear(null, remembered)
        : null;
      setBrief(near
        ? { ...personalized, picks: orderPicksNear(personalized.picks, near.near) }
        : personalized);
      setBriefShape({
        personalized: resolved.personalized,
        muted: personalized.filteredPickCount > 0,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [picks, weather, weatherByArea, pintsIndex]);

  return (
    <main id="main" className="todayPage" data-testid="today-screen">
      <SiteNav active="today" />
      <NowSegment current="day" />

      {/* The head is the Screen primitive (docs/design/LAUNCH_SCREENS.md):
          the kicker names the surface and the heading is the table's own,
          "What's on across London today." It used to be a generated weather
          verdict ("Cold out. Fireplace weather.") over a card that said
          "Stout weather.", two weather lines that read as written by a
          machine (taste plan, 18 Oct 2026). The sky is said once now, in the
          weather section; the personal line under the heading is the
          salutation and the date. Find my pint is the one primary and the
          map the quieter way onward, said once on the page. */}
      <Screen
        as="div"
        className="todayScreen"
        kicker="Today in London"
        title={TODAY_HEADING}
        titleId="today-title"
        lede={
          // One string, so the server HTML carries one text node: three JSX
          // children put React's separators round the period, and a reader of
          // the stripped document saw "Good morning ." with no name.
          <span data-testid="today-greeting">
            {`${shownGreeting.salutation}. ${shownDateLabel}.`}
          </span>
        }
        primary={
          <Link prefetch={false} href="/near?locate=1">
            Find my pint
          </Link>
        }
        secondary={
          <Link prefetch={false} href="/map">
            Open the map
          </Link>
        }
      >
      <PreparedBriefStamp preparedAt={nowIso} />
      <div className="todayStack">
        <div className="todayBriefColumn">
          <WeatherCard weather={brief.weather} />
          <TodayTubeCard slot={shownGreeting.slot} initialDisruption={initialDisruption} />
          <PicksCard
            picksCheckedAt={picksCheckedAt}
            picksReason={picksReason}
            picksRetryable={picksRetryable}
            context={picksContext}
            picks={brief.picks}
            filteredPickCount={brief.filteredPickCount}
            slot={shownGreeting.slot}
            picksStatus={picksStatus}
            hypedPubs={hypedPubs}
            selectableVenueIds={mapSelectableVenueIds ? new Set(mapSelectableVenueIds) : null}
          />
          <TodayGetThereStrip />
        </div>
        <div className="todayExploreColumn">
          <TodayPintsCard index={pintsIndex} />
          <TodayQuietPintCard module={quietPint} />
          <FactCard fact={fact} />
        </div>
      </div>

      {/* One way onward once the brief is read. Tonight is the Day/Tonight
          pair at the top and the map is the head's own secondary, so the foot
          no longer repeats either. */}
      <p className="todayFoot">
        <Link prefetch={false} href="/plan" className="todayInkLink">
          Plan an outing
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </p>
      </Screen>
    </main>
  );
}
