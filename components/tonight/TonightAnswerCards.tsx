import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink, LocateFixed } from "lucide-react";

import { PintPriceBadge } from "@/components/PriceBadge";
import { ReadyButton } from "@/components/ui/ready-button";
import { formatSnapshotFrom } from "@/lib/dataFreshness";
import AddRegularNight from "@/components/tonight/AddRegularNight";
import RegularNightStillOn from "@/components/tonight/RegularNightStillOn";
import {
  DRINKER_REGULAR_NIGHTS_HEADING,
  DRINKER_REGULAR_NIGHTS_LEAD,
  drinkerRegularNightByline,
  drinkerRegularNightSourceLine,
  REGULAR_NIGHTS_HEADING,
  regularNightsLead,
  regularNightSourceLine,
  regularNightTimeLabel,
  type DrinkerRegularNight,
  type RegularNight,
  type RegularNightsAnswer,
} from "@/lib/regularNights";
import {
  tonightCheapestHeading,
  type TonightCheapestAnswer,
} from "@/lib/tonightAnswers";
import type { GetHomeSummary } from "@/lib/tonightGetHome";

import "./tonightAnswers.css";

/** One confirmed listing, already worded by the page that read it. */
export type TonightAnswerListing = {
  title: string;
  placeName: string;
  when: string | null;
  sourceLabel: string;
  href: string | null;
  external: boolean;
};

export type TonightRegularNightsView =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; answer: RegularNightsAnswer };

export type TonightLastTrainView =
  | { status: "no-location" }
  | { status: "loading" }
  | { status: "ready"; summary: GetHomeSummary }
  | { status: "none" };

/** How many regular nights the card lists before the rest fold away. */
export const TONIGHT_REGULAR_NIGHTS_SHOWN = 3;

/** The line the On tonight card says when the read holds no confirmed listing. */
export const TONIGHT_NO_CONFIRMED_LISTING_LINE = "No confirmed listings for tonight yet.";

function mapHref(venueId: string): Route {
  return `/map?sel=${encodeURIComponent(venueId)}` as Route;
}

function CheapestCard({ cheapest }: { cheapest: TonightCheapestAnswer | null }) {
  if (!cheapest) return null;
  return (
    <li className="tonightAnswer" data-testid="tonight-answer-cheapest" data-basis={cheapest.basis}>
      <h2 className="tonightAnswerTitle">{tonightCheapestHeading(cheapest.basis)}</h2>
      <p className="tonightAnswerLead">
        <Link prefetch={false} href={mapHref(cheapest.venueId)} className="tonightAnswerLink">
          {cheapest.name}
        </Link>
        <PintPriceBadge priceGbp={cheapest.priceGbp} venueId={cheapest.venueId} />
      </p>
      <p className="tonightAnswerMeta">
        {cheapest.placeLine}
        {cheapest.observedAt ? ` · ${formatSnapshotFrom(new Date(cheapest.observedAt))}` : " · No read date on file"}
      </p>
    </li>
  );
}

function RegularNightRow({ night }: { night: RegularNight }) {
  const time = regularNightTimeLabel(night.time);
  return (
    <li className="tonightRegularRow" data-kind={night.kind}>
      <span className="tonightRegularTitle">
        {night.venueId ? (
          <Link prefetch={false} href={mapHref(night.venueId)} className="tonightAnswerLink">
            {night.placeName}
          </Link>
        ) : (
          night.placeName
        )}
      </span>
      <span className="tonightAnswerMeta">
        {night.title}
        {time ? `, ${time}` : ""}
        {" · "}
        {night.source.url ? (
          <a
            className="tonightAnswerSource"
            href={night.source.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {regularNightSourceLine(night)}
          </a>
        ) : (
          regularNightSourceLine(night)
        )}
      </span>
    </li>
  );
}

/** One night a drinker added: "per a drinker, seen <date>", and whose word it is. */
function DrinkerNightRow({ night }: { night: DrinkerRegularNight }) {
  const time = regularNightTimeLabel(night.time);
  return (
    <li className="tonightRegularRow" data-kind={night.kind} data-source="drinker" data-confirmed={night.confirmed}>
      <span className="tonightRegularTitle">
        <Link prefetch={false} href={mapHref(night.venueId)} className="tonightAnswerLink">
          {night.placeName}
        </Link>
      </span>
      <span className="tonightAnswerMeta">
        {night.title}
        {time ? `, ${time}` : ""}
        {night.note ? `. ${night.note}` : ""}
        {` · ${drinkerRegularNightSourceLine(night)} · ${drinkerRegularNightByline(night)}`}
      </span>
      <RegularNightStillOn night={night} />
    </li>
  );
}

/**
 * The regular nights, in a block of their own. It is never mixed into the
 * confirmed listings and never called one: its heading says "Regular nights",
 * its lead says it is not tonight's listing, and every row names its source and
 * the day that source was read. Nights drinkers added sit in a list of their
 * own under it, each "per a drinker, seen <date>".
 */
export function TonightRegularNights({ view }: { view: TonightRegularNightsView }) {
  if (view.status === "loading") {
    return <p className="tonightAnswerMeta" role="status">Checking the regular nights.</p>;
  }
  if (view.status === "failed") {
    return <p className="tonightAnswerMeta" role="status">We couldn’t read the regular nights just now.</p>;
  }
  const { answer } = view;
  const shown = answer.nights.slice(0, TONIGHT_REGULAR_NIGHTS_SHOWN);
  const rest = answer.nights.slice(TONIGHT_REGULAR_NIGHTS_SHOWN);
  const drinker = answer.drinker ?? [];
  if (shown.length === 0 && answer.sport.length === 0 && drinker.length === 0) return null;
  return (
    <section
      className="tonightRegular"
      aria-labelledby="tonight-regular-heading"
      data-testid="tonight-regular-nights"
    >
      <h3 className="tonightRegularHeading" id="tonight-regular-heading">
        {REGULAR_NIGHTS_HEADING}
      </h3>
      <p className="tonightAnswerMeta">{regularNightsLead(answer)}</p>
      {shown.length > 0 ? (
        <ul className="tonightRegularList">
          {shown.map((night) => (
            <RegularNightRow key={night.id} night={night} />
          ))}
        </ul>
      ) : null}
      {rest.length > 0 ? (
        <details className="tonightRegularMore">
          <summary>{`${rest.length} more on ${answer.weekdayLabel}s`}</summary>
          <ul className="tonightRegularList">
            {rest.map((night) => (
              <RegularNightRow key={night.id} night={night} />
            ))}
          </ul>
        </details>
      ) : null}
      {answer.sport.length > 0 ? (
        <>
          <p className="tonightAnswerMeta">
            {`Pubs that say they show live sport. Screens, not a fixture list.`}
          </p>
          <ul className="tonightRegularList" data-testid="tonight-regular-sport">
            {answer.sport.map((night) => (
              <RegularNightRow key={night.id} night={night} />
            ))}
          </ul>
        </>
      ) : null}
      {drinker.length > 0 ? (
        <div data-testid="tonight-regular-drinker">
          <h4 className="tonightRegularHeading">{DRINKER_REGULAR_NIGHTS_HEADING}</h4>
          <p className="tonightAnswerMeta">{DRINKER_REGULAR_NIGHTS_LEAD}</p>
          <ul className="tonightRegularList">
            {drinker.map((night) => (
              <DrinkerNightRow key={night.id} night={night} />
            ))}
          </ul>
        </div>
      ) : null}
      <AddRegularNight where="tonight" />
    </section>
  );
}

function OnTonightCard({
  listing,
  regular,
}: {
  listing: TonightAnswerListing | null;
  regular: TonightRegularNightsView | null;
}) {
  if (!listing && !regular) return null;
  return (
    <li className="tonightAnswer" data-testid="tonight-answer-on" data-answer={listing ? "listing" : "regular"}>
      <h2 className="tonightAnswerTitle">On tonight</h2>
      {listing ? (
        <>
          <p className="tonightAnswerLead">
            {listing.href ? (
              listing.external ? (
                <a
                  className="tonightAnswerLink"
                  href={listing.href}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {listing.title}
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              ) : (
                <Link prefetch={false} href={listing.href as Route} className="tonightAnswerLink">
                  {listing.title}
                </Link>
              )
            ) : (
              listing.title
            )}
          </p>
          <p className="tonightAnswerMeta">
            {listing.placeName}
            {listing.when ? ` · ${listing.when}` : ""}
            {` · via ${listing.sourceLabel}`}
          </p>
          <p className="tonightAnswerMeta">
            <a href="#tonight-list" className="tonightAnswerLink">
              All tonight’s listings
              <ArrowRight size={14} aria-hidden="true" />
            </a>
          </p>
        </>
      ) : (
        <>
          <p className="tonightAnswerMeta">{TONIGHT_NO_CONFIRMED_LISTING_LINE}</p>
          {regular ? <TonightRegularNights view={regular} /> : null}
        </>
      )}
    </li>
  );
}

function LastTrainCard({
  view,
  onShareLocation,
}: {
  view: TonightLastTrainView;
  onShareLocation: () => void;
}) {
  return (
    <li className="tonightAnswer" data-testid="tonight-answer-last-train" data-status={view.status}>
      <h2 className="tonightAnswerTitle">Last train</h2>
      {view.status === "ready" ? (
        <>
          <p className="tonightAnswerLead">{view.summary.trainLine}</p>
          <p className="tonightAnswerMeta">{view.summary.statusLine} Live from TfL.</p>
        </>
      ) : view.status === "loading" ? (
        <p className="tonightAnswerMeta" role="status">Checking the last train from here.</p>
      ) : view.status === "none" ? (
        <p className="tonightAnswerMeta">TfL has no last train time for this spot right now.</p>
      ) : (
        <>
          <p className="tonightAnswerMeta">Share your location and we’ll find your nearest station’s last train.</p>
          <ReadyButton type="button" className="tonightAnswerButton" onClick={onShareLocation}>
            <LocateFixed size={16} aria-hidden="true" />
            Share location
          </ReadyButton>
        </>
      )}
    </li>
  );
}

/**
 * The three answers above Tonight's rows (design V1): the cheapest pint near
 * the reader, one confirmed listing or the regular nights, and the last train.
 * Each card answers in one line and one action, and a card with nothing it can
 * back says so in words rather than printing a zero.
 */
export default function TonightAnswerCards({
  cheapest,
  listing,
  regular,
  lastTrain,
  onShareLocation,
}: {
  cheapest: TonightCheapestAnswer | null;
  /** The confirmed listing the card leads with, or null when the read holds none. */
  listing: TonightAnswerListing | null;
  /** The regular nights, shown only when there is no confirmed listing. */
  regular: TonightRegularNightsView | null;
  lastTrain: TonightLastTrainView;
  onShareLocation: () => void;
}) {
  return (
    <ul className="tonightAnswers" aria-label="Tonight in three answers" data-testid="tonight-answers">
      <CheapestCard cheapest={cheapest} />
      <OnTonightCard listing={listing} regular={listing ? null : regular} />
      <LastTrainCard view={lastTrain} onShareLocation={onShareLocation} />
    </ul>
  );
}
