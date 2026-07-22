"use client";

// The morning brief surface (/today). Four stacked cards, mobile-first, both
// themes via role tokens. Cards 1, 2 and 4 render from server-composed props
// (lib/todayBrief.ts); card 3 owns its own location + live TfL. Every sourced
// claim carries its attribution, and every card has an honest empty/stale state
// rather than filler. No em dashes in any copy.

import Link from "next/link";
import {
  ArrowUpRight,
  Beer,
  CalendarClock,
  CloudSun,
  ExternalLink,
  Landmark,
  MapPin,
} from "lucide-react";

import { useEffect, useState } from "react";

import SiteNav from "@/components/nav/SiteNav";
import { readRememberedArea } from "@/lib/nightPatches";
import { resolveTonightNear } from "@/lib/tonight";
import { orderPicksNear, type TodayFact, type TonightPickDto, type WeatherBrief } from "@/lib/todayBrief";

import TodayGetThereStrip from "./TodayGetThereStrip";
import TodayPintsCard from "./TodayPintsCard";
import TodayTubeCard from "./TodayTubeCard";
import type { TodayPintsIndex } from "./todayPints";
import "./today.css";

type Props = {
  dateLabel: string;
  weather: WeatherBrief | null;
  picks: TonightPickDto[];
  fact: TodayFact | null;
  pintsIndex: TodayPintsIndex;
};

function WeatherCard({ weather }: { weather: WeatherBrief | null }) {
  return (
    <section className="todayCard" aria-labelledby="today-weather-title" data-testid="today-weather">
      <div className="todayCardHead">
        <span className="todayCardIcon" aria-hidden="true">
          <CloudSun size={18} />
        </span>
        <div>
          <p className="todayCardEyebrow">Drink weather</p>
          <h2 className="todayCardTitle" id="today-weather-title">
            {weather ? weather.verdictLine : "No weather verdict right now."}
          </h2>
        </div>
      </div>

      {weather ? (
        <>
          <p className="todayCardBody">
            {weather.tempLabel}, {weather.conditionLabel}. Reach for {weather.drinkSuggestion}.
          </p>
          {weather.stale ? (
            <p className="todayStale" role="status">
              {weather.checkedLabel}. It may have moved on. We refresh this by hand right now.
            </p>
          ) : null}
          <div className="todayCardFootRow">
            <span className="todayProvenance">
              {weather.checkedLabel}
              <span aria-hidden="true"> · </span>
              via{" "}
              <a
                className="todayProvenanceLink"
                href={weather.source.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {weather.source.publisher}
              </a>
            </span>
          </div>
        </>
      ) : (
        <p className="todayCardEmpty">
          No fresh read on the sky just now. Have a look out the window, we&apos;ll
          catch up shortly.
        </p>
      )}
    </section>
  );
}

function PicksCard({ picks }: { picks: TonightPickDto[] }) {
  return (
    <section className="todayCard" aria-labelledby="today-picks-title" data-testid="today-picks">
      <div className="todayCardHead">
        <span className="todayCardIcon" aria-hidden="true">
          <CalendarClock size={18} />
        </span>
        <div>
          <p className="todayCardEyebrow">Tonight</p>
          <h2 className="todayCardTitle" id="today-picks-title">
            Top picks for tonight.
          </h2>
        </div>
      </div>

      {picks.length > 0 ? (
        <>
          <ul className="todayPicks">
            {picks.map((pick) => {
              const inner = (
                <>
                  <div className="todayPickMeta">
                    <span className="todayPickKind" data-kind={pick.kind}>
                      {pick.kindLabel}
                    </span>
                    {pick.priceGbp !== null ? (
                      <span className="todayPickPrice">£{pick.priceGbp.toFixed(2)}</span>
                    ) : null}
                  </div>
                  <h3 className="todayPickTitle">{pick.title}</h3>
                  <p className="todayPickPlace">
                    <MapPin size={13} aria-hidden="true" />
                    <span>{pick.placeName}</span>
                  </p>
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
                        <ExternalLink size={13} aria-hidden="true" className="todayPickArrow" />
                      </a>
                    ) : (
                      <Link className="todayPickLink pressable" href={pick.href}>
                        {inner}
                        <ArrowUpRight size={14} aria-hidden="true" className="todayPickArrow" />
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
            <Link href="/tonight" className="todayCardFootLink">
              See everything on tonight
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </p>
        </>
      ) : (
        <>
          <p className="todayCardEmpty">
            Nothing confirmed for tonight yet. Listings firm up through the
            afternoon.
          </p>
          <p className="todayCardFootRow">
            <Link href="/map" className="todayCardFootLink">
              Meanwhile, the map knows the cheap pints
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </p>
        </>
      )}
    </section>
  );
}

function FactCard({ fact }: { fact: TodayFact | null }) {
  return (
    <section className="todayCard" aria-labelledby="today-fact-title" data-testid="today-fact">
      <div className="todayCardHead">
        <span className="todayCardIcon" aria-hidden="true">
          <Landmark size={18} />
        </span>
        <div>
          <p className="todayCardEyebrow">Pub of the day</p>
          <h2 className="todayCardTitle" id="today-fact-title">
            {fact ? fact.pubName : "Still in the archive"}
          </h2>
        </div>
      </div>

      {fact ? (
        <>
          <p className="todayCardBody">{fact.fact}</p>
          <div className="todayCardFootRow">
            <span className="todayProvChip" data-provenance={fact.provenance}>
              {fact.provenanceLabel}
            </span>
            {fact.sourceRef ? (
              <a
                className="todayTextButton"
                href={fact.sourceRef}
                target="_blank"
                rel="noreferrer noopener"
              >
                View source
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </>
      ) : (
        <p className="todayCardEmpty">
          Every pub of the day comes with receipts, and today&apos;s are still in
          the archive. Back tomorrow.
        </p>
      )}
    </section>
  );
}

export default function TodayClient({ dateLabel, weather, picks, fact, pintsIndex }: Props) {
  // Silent continuity (#427 seam): if the viewer chose an area anywhere in the
  // app, lead with the picks nearest it. Same server-chosen picks, same count,
  // order only; no remembered area = server order untouched. localStorage is
  // read inside the effect so the first paint always matches SSR.
  const [orderedPicks, setOrderedPicks] = useState(picks);
  useEffect(() => {
    let cancelled = false;
    // Deferred like useWhatsOnTonight's setState: reading localStorage is the
    // external-system sync; the state lands next microtask (react-hooks rule).
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const near = resolveTonightNear(null, readRememberedArea());
      setOrderedPicks(near ? orderPicksNear(picks, near.near) : picks);
    });
    return () => {
      cancelled = true;
    };
  }, [picks]);

  return (
    <main className="todayPage" data-testid="today-screen">
      <SiteNav active="today" />

      <header className="todayHead">
        <p className="todayEyebrow">This morning</p>
        <h1 className="todayTitle">Your day out, sorted.</h1>
        <p className="todayLede">
          <span className="todayDate">{dateLabel}</span>. The weather, tonight&rsquo;s best,
          how you&rsquo;ll get home, and one to remember.
        </p>
      </header>

      <div className="todayStack">
        <WeatherCard weather={weather} />
        <TodayTubeCard />
        <PicksCard picks={orderedPicks} />
        <TodayGetThereStrip />
        <TodayPintsCard index={pintsIndex} />
        <FactCard fact={fact} />
      </div>

      <p className="todayFoot">
        <Link href="/tonight" className="todayCardFootLink">
          Jump to tonight
          <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
        <Link href="/map" className="todayCardFootLink">
          <Beer size={14} aria-hidden="true" />
          Open the map
        </Link>
      </p>
    </main>
  );
}
