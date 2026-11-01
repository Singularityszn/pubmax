"use client";

// The daytime page (/today). A personal greeting over a stack of daytime
// answers, mobile-first, both themes via role tokens: the weather, the Tube,
// work spots, coffee, lunch at a pub, a quiet pint, the cheap pints and the
// last train, with the pub of the day at the foot. Tonight's picks live on
// /tonight alone (design V1, 30 Oct 2026), so this page repeats none of them. Most cards render from
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
//
// Every daytime module is composed on the server for each night patch
// (./todayDaytime.ts); the reader's remembered area picks one after mount, and
// a module with no rows is no section.

import Link from "next/link";
import { ArrowRight, ExternalLink, MapPin } from "lucide-react";

import { useEffect, useState, useSyncExternalStore } from "react";
import { formatConditionDate } from "@/lib/tonightConditions";

import NowSegment from "@/components/nav/NowSegment";
import SiteNav from "@/components/nav/SiteNav";
import Screen from "@/components/ui/screen";
import PreparedBriefStamp from "@/components/seo/PreparedBriefStamp";
import { buildDayGreeting, type DayGreeting } from "@/lib/dayGreeting";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import {
  TodayCoffee,
  TodayLunch,
  TodayWorkSpots,
} from "@/components/today/TodayDaytimeSections";
import { useLoopMoment } from "@/components/loop/useLoopMoment";
import { arrivedFromBriefingPush } from "@/lib/briefingArrival";
import type { NightAreaSlug } from "@/lib/nightAreas";
import {
  NIGHT_PATCHES,
  readRememberedArea,
  rememberedPatchId,
} from "@/lib/nightPatches";
import { PLAN_INTAKE_STORAGE_KEY, parsePlanIntakeDraft } from "@/lib/planIntake";
import type { WeatherBrief } from "@/lib/todayBrief";
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
import type {
  TodayCoffeeModule,
  TodayLunchIndex,
  TodayWorkSpotsIndex,
} from "./todayDaytime";
import { todayPatchModule } from "./todayPatch";
import type { QuietPintModule } from "@/lib/quietPint";
import "./today.css";

type Props = {
  dateLabel: string;
  /** The server instant used for the first render before the client clock is available. */
  nowIso: string;
  greeting: DayGreeting;
  weather: WeatherBrief | null;
  weatherByArea: Partial<Record<NightAreaSlug, WeatherBrief | null>>;
  fact: PubOfTheDayCard | null;
  pintsIndex: TodayPintsIndex;
  quietPint: QuietPintModule | null;
  /** Work spots around each patch, off the /near Work spots pack. */
  workSpots?: TodayWorkSpotsIndex;
  /** Pubs that serve food and publish a menu, around each patch. */
  lunch?: TodayLunchIndex;
  /** The Shoreditch coffee pilot's cheapest listed flat whites. */
  coffee?: TodayCoffeeModule | null;
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
  fact,
  pintsIndex,
  quietPint,
  workSpots = EMPTY_WORK_SPOTS,
  lunch = EMPTY_LUNCH,
  coffee = null,
}: Props) {
  const [brief, setBrief] = useState<{ weather: WeatherBrief | null; patchId: string | null }>({
    weather,
    patchId: null,
  });
  // What the brief turned out to be, once the deferred personalization pass has
  // run. Null means "not resolved yet", so the impression is never reported off
  // a state the reader has not been shown.
  const [briefShape, setBriefShape] = useState<BriefShape | null>(null);
  // Did this arrival come from the daily-brief notification's own landing?
  // Read after mount, because the server has no reader's URL to read.
  const [openedFromBrief, setOpenedFromBrief] = useState(false);

  // Who the salutation may name. SSR and hydration both see nobody, then the
  // live session answers. Nothing about the layout depends on it, so its
  // arrival only ever appends a name, and a name it is not yet sure of is the
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

  // Silent continuity (#427 seam), resolved field-by-field. The progressive
  // intake is the only newly consumed source in this UI wave. localStorage
  // remains effect-only so the first paint matches SSR: central London's
  // daytime modules first, then the reader's own area once it is read.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const remembered = readRememberedArea();
      const rememberedPatch = NIGHT_PATCHES.find(
        (patch) => patch.id === rememberedPatchId(remembered),
      )?.id ?? null;
      // The same deferred pass reads the address once: whether this arrival
      // carried the daily brief's own landing marker.
      setOpenedFromBrief(arrivedFromBriefingPush(window.location.search));
      const resolved = resolveTodayPersonalization({
        progressiveIntake: readPlanIntakeDraftReadonly(),
        reviewedDevice: null,
        defaults: rememberedPatch ? { preferredPatch: rememberedPatch } : null,
      });
      // Tonight's picks no longer ride this page, so only the weather is
      // personalised here; the daytime modules follow the patch.
      const personalized = applyTodayPersonalization(
        { weather, picks: [], filteredPickCount: 0 },
        weatherByArea,
        resolved,
      );
      setBrief({
        weather: personalized.weather,
        patchId: resolved.preferredPatch.value ?? rememberedPatch,
      });
      setBriefShape({ personalized: resolved.personalized, muted: false });
    });
    return () => {
      cancelled = true;
    };
  }, [weather, weatherByArea]);

  const workSpotsModule = todayPatchModule(brief.patchId, workSpots);
  const lunchModule = todayPatchModule(brief.patchId, lunch);

  return (
    <main id="main" className="todayPage" data-testid="today-screen">
      <SiteNav active="today" />
      <NowSegment current="day" />

      {/* The head is the Screen primitive (docs/design/LAUNCH_SCREENS.md):
          the kicker names the surface and the heading is the table's own.
          The sky is said once, in the weather section; the personal line
          under the heading is the salutation and the date. Find my pint is
          the one primary and the map the quieter way onward. */}
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
          <TodayTubeCard slot={shownGreeting.slot} />
          <TodayWorkSpots module={workSpotsModule} />
          <TodayCoffee module={coffee} />
          <TodayLunch module={lunchModule} />
        </div>
        <div className="todayExploreColumn">
          <TodayQuietPintCard module={quietPint} />
          <TodayPintsCard index={pintsIndex} />
          <TodayGetThereStrip />
        </div>
      </div>

      {/* The pub of the day closes the page: something to read once the
          day's answers are in, never the first thing a reader meets. */}
      <FactCard fact={fact} />

      {/* Two ways onward once the day is read: tonight's page, and a plan. */}
      <p className="todayFoot">
        <Link prefetch={false} href="/tonight" className="todayInkLink">
          What’s on tonight
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
        <Link prefetch={false} href="/plan" className="todayInkLink">
          Plan an outing
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </p>
      </Screen>
    </main>
  );
}

const EMPTY_WORK_SPOTS: TodayWorkSpotsIndex = {};
const EMPTY_LUNCH: TodayLunchIndex = {};
