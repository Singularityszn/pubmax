"use client";

import type { Route } from "next";
import Link from "next/link";
import { LocateFixed } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import PriceBadge from "@/components/PriceBadge";
import Kicker from "@/components/ui/kicker";
import Screen from "@/components/ui/screen";
import { slugifyBorough } from "@/lib/boroughs";
import { trackEvent } from "@/lib/analytics";
import type { LandingCtaTarget } from "@/lib/analyticsEvents";
import type { LegacyPintPrice } from "@/lib/drinks";
import {
  getTourSeenServerSnapshot,
  getTourSeenSnapshot,
  subscribeTour,
} from "@/lib/firstRunTour";
import {
  answerEvidenceFor,
  answerKicker,
  HERO_RAIL_SIZE,
  LANDING_FALLBACK_RECEIPT_HREF,
  LANDING_FALLBACK_RECEIPT_LABEL,
  LANDING_PRIMARY_LABEL,
  LANDING_QUIET_DOORS,
  NEAR_ME_CONTROL_BUSY_LABEL,
  NEAR_ME_CONTROL_LABEL,
  NEAR_ME_FAILED_LINE,
  NEAR_ME_NOTHING_LINE,
  landingPrimaryHref,
  pintDropDoorHref,
  railHeading,
  stillPriceLabel,
  type AnswerPublisher,
  type LandingAnswerScope,
  type LandingArchiveIndex,
  type LandingArchiveThen,
  type LandingRailRow,
} from "@/lib/landingHero";
import type { LandingPubCardData } from "@/lib/landingPubCard";
import {
  landingPhotoFor,
  type ResolvedLandingPhoto,
} from "@/lib/landingImagery";
import { NEAR_ME_LOCATION_OPTIONS } from "@/lib/nearMeLocation";
import type { NearMeCard } from "@/lib/nearMeAnswer";
import { priceMovementLine } from "@/lib/priceMovementLine";
import { priceStandingLabel, priceStandingNote, type PriceStanding } from "@/lib/priceTier";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { discardBody } from "@/lib/responseBody";
import {
  LANDING_SKYLINE_HERO_AVIF_SRCSET,
  LANDING_SKYLINE_HERO_JPG_FALLBACK,
  LANDING_SKYLINE_HERO_SIZES,
  LANDING_SKYLINE_HERO_WEBP_SRCSET,
} from "@/lib/landingSkylineHero";
import { formatPrice } from "@/lib/venues";
import { venueMapUrl } from "@/lib/venueMapUrl";

import LandingPhoto, { LandingPhotoCredit } from "./LandingPhoto";
import { LONDON_MAP_PUB_COUNT } from "./londonMapGeometry";

// The landing hero (issue #1357, rebuilt on the captain's 7 Sep 2026 ask):
// kicker, the claim, one line under it, the PICTURE, then the one filled action,
// then the quiet row, then the pub card and the three next-cheapest rows. The
// DOM order is the phone order; the desktop seats the picture and the rows
// beside the copy.
//
// The hero shows the London skyline the captain selected. The responsive files
// are committed under public/landing; the live map is still one tap away.
//
// THE PRIMARY GIVES BEFORE IT ASKS. The receipt door was the primary until
// today and it ends in a sign-in ask, so it is the first QUIET door now and
// /near is the filled one (lib/landingHero.ts).
//
// The pub card under the picture stands on a photograph of London (captain
// 6 Sep 2026): the pub itself where we hold its picture, else its borough, else
// the city. Everything the card prints is a fact with its source beside it, and
// the browser only ever swaps the anchor for a near-you answer built from the
// same slim index /near ranks. lib/landingImagery.ts owns which picture, whose
// it is, and the scrim that keeps every line over it inside WCAG AA.

/** What the card really paints at: the answer column, capped at the card. */
const ANSWER_PHOTO_SIZES = "(max-width: 959px) calc(100vw - 2rem), 480px";
/** Phone and tablet only: on desktop the Thames picture is the largest paint. */
const ANSWER_PHOTO_PRELOAD_MEDIA = "(max-width: 959px)";
const LONDON_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

function collectedDay(iso: string): string {
  const ms = Date.parse(`${iso}T12:00:00.000Z`);
  return Number.isFinite(ms) ? LONDON_DAY.format(new Date(ms)) : iso;
}

function trackLandingCta(target: LandingCtaTarget) {
  trackEvent("landing_cta_clicked", { target });
}

/**
 * What the card knows about who listed the price. The anchor arrives
 * resolved; a near-you answer is `loading` until the venue read answers, and
 * `unavailable` when that read could not be run, which is not the same thing
 * as a pub nobody has listed.
 */
type Evidence =
  | "loading"
  | "unavailable"
  | { publisher: AnswerPublisher | null; standing: PriceStanding; observedOn: string | null };

/** What the card prints, whichever lane it came from. */
type Answer = {
  id: string;
  name: string;
  area: string;
  priceGbp: number;
  /** "a pint of Pravha" for the anchor; the slim index names no pint. */
  pintName: string | null;
  /** The pint's own drink page, when one publishes (lib/landingPubCard.ts). */
  drinkHref: Route | null;
  scope: LandingAnswerScope;
  walkMinutes?: number;
  evidence: Evidence;
  then: LandingArchiveThen | null;
  rail: LandingRailRow[];
};

type NearState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "answered" }
  | { kind: "failed"; line: string };

function anchorAnswer(
  card: LandingPubCardData,
  rail: LandingRailRow[],
  archive: LandingArchiveIndex,
): Answer {
  return {
    id: card.id,
    name: card.name,
    area: card.area,
    priceGbp: card.priceGbp,
    pintName: card.pintName,
    drinkHref: card.drinkHref,
    scope: "anchor",
    evidence: { publisher: card.publisher, standing: card.standing, observedOn: card.observedOn },
    // The index holds the anchor's own then row with its printed labels.
    then: archive[card.id] ?? null,
    rail,
  };
}

function nearAnswer(
  first: NearMeCard,
  rest: NearMeCard[],
  scope: "walkable" | "widened",
  archive: LandingArchiveIndex,
): Answer {
  return {
    id: first.id,
    name: first.name,
    area: first.borough,
    priceGbp: first.cheapestPrice,
    pintName: null,
    drinkHref: null,
    scope,
    walkMinutes: first.walkMinutes,
    evidence: "loading",
    then: archive[first.id] ?? null,
    rail: rest.slice(0, HERO_RAIL_SIZE).map((card) => ({
      id: card.id,
      name: card.name,
      area: card.borough,
      priceGbp: card.cheapestPrice,
      walkMinutes: card.walkMinutes,
      hasThen: card.id in archive,
    })),
  };
}

/**
 * The publisher and standing for a near-you answer, read off the same venue
 * detail the sheet reads, through the same decider the anchor used at build.
 * A read that could not be run answers `unavailable`, never "no publisher".
 */
async function readEvidence(
  venueId: string,
  priceGbp: number,
  signal: AbortSignal,
): Promise<Evidence> {
  try {
    const response = await fetch(`/api/venue/${encodeURIComponent(venueId)}`, { signal });
    if (!response.ok) {
      discardBody(response);
      return "unavailable";
    }
    const payload = (await response.json()) as { venue?: { prices?: LegacyPintPrice[] } };
    const prices = Array.isArray(payload.venue?.prices) ? payload.venue.prices : null;
    if (!prices) return "unavailable";
    return answerEvidenceFor({ priceGbp, prices });
  } catch {
    return "unavailable";
  }
}

export default function LandingHero({
  card,
  archive,
  rail,
}: {
  /** The one real pub, or null when the data cannot back one. */
  card: LandingPubCardData | null;
  archive: LandingArchiveIndex;
  rail: LandingRailRow[];
}) {
  const [answer, setAnswer] = useState<Answer | null>(() =>
    card ? anchorAnswer(card, rail, archive) : null,
  );
  const [near, setNear] = useState<NearState>({ kind: "idle" });
  const generation = useRef(0);
  const hasCard = card !== null;
  // The document ships the returning visitor's door (the server snapshot says
  // seen), and the browser points a first-time visitor at the journey.
  const seenOnboarding = useSyncExternalStore(
    subscribeTour,
    getTourSeenSnapshot,
    getTourSeenServerSnapshot,
  );

  // The swap. One generation counter keeps a slow first read from landing
  // over a later one. The ranker and the slim index load only here, so the
  // landing's own bundle never carries them for a reader who never taps.
  const locate = useCallback(() => {
    if (!hasCard) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNear({ kind: "failed", line: NEAR_ME_FAILED_LINE });
      return;
    }
    const mine = ++generation.current;
    setNear({ kind: "requesting" });
    const fail = (line: string) => {
      if (mine !== generation.current) return;
      setNear({ kind: "failed", line });
    };
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void Promise.all([import("@/lib/venuesSlim"), import("@/lib/nearMeAnswer")])
          .then(async ([slimModule, rankModule]) => {
            const slim = await slimModule.loadSlimVenuesForCity("london");
            if (mine !== generation.current) return;
            const ranked = rankModule.rankNearMe(
              position.coords.latitude,
              position.coords.longitude,
              slim,
            );
            const [first, ...rest] = ranked.cards;
            if (ranked.scope === "none" || !first) {
              fail(NEAR_ME_NOTHING_LINE);
              return;
            }
            setAnswer(nearAnswer(first, rest, ranked.scope, archive));
            setNear({ kind: "answered" });
            const controller = new AbortController();
            const evidence = await readEvidence(first.id, first.cheapestPrice, controller.signal);
            if (mine !== generation.current) return;
            setAnswer((current) =>
              current && current.id === first.id ? { ...current, evidence } : current,
            );
          })
          .catch(() => fail(NEAR_ME_FAILED_LINE));
      },
      () => fail(NEAR_ME_FAILED_LINE),
      NEAR_ME_LOCATION_OPTIONS,
    );
  }, [archive, hasCard]);

  // A reader who already said yes gets the near-you answer with no tap. A
  // reader who has not is never asked on arrival: the control on the card asks.
  useEffect(() => {
    if (!hasCard) return;
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (!cancelled && status.state === "granted") locate();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasCard, locate]);

  // Which picture the card stands on. It follows the ANSWER, so a near-you
  // swap moves to that pub's own borough rather than keeping the anchor's.
  const photo = landingPhotoFor(
    answer
      ? { venueId: answer.id, boroughSlug: slugifyBorough(answer.area) }
      : {},
  );
  // The one filled action, and it is the same door whether or not a pub card
  // stands behind the document: /near answers in one tap, with the first-run
  // journey in front of it for a first-time visitor.
  const primary = (
    <Link
      prefetch={false}
      href={landingPrimaryHref(seenOnboarding)}
      onClick={() => trackLandingCta("near")}
    >
      {LANDING_PRIMARY_LABEL}
    </Link>
  );

  // The receipt door, quiet now. It carries the anchor pub where there is one,
  // so the label still names the figure the card printed.
  const receipt = answer ? (
    <Link
      key="receipt"
      prefetch={false}
      href={pintDropDoorHref(answer.id, answer.priceGbp)}
      onClick={() => trackLandingCta("receipt")}
      aria-describedby="lp-answer-name"
    >
      {stillPriceLabel(answer.priceGbp)}
    </Link>
  ) : (
    <Link
      key="receipt"
      prefetch={false}
      href={LANDING_FALLBACK_RECEIPT_HREF}
      onClick={() => trackLandingCta("receipt")}
    >
      {LANDING_FALLBACK_RECEIPT_LABEL}
    </Link>
  );

  return (
    <Screen
      className="lpHero"
      kicker="PUBMAXX"
      title="What a pint costs, pub by pub."
      titleId="hero-title"
      lede={`London on one map, with ${LONDON_MAP_PUB_COUNT} historic pubs marked and a listed price wherever we hold one.`}
      answer={
        <figure className="lpLondonFigure">
          <picture>
            <source
              type="image/avif"
              srcSet={LANDING_SKYLINE_HERO_AVIF_SRCSET}
              sizes={LANDING_SKYLINE_HERO_SIZES}
            />
            <source
              type="image/webp"
              srcSet={LANDING_SKYLINE_HERO_WEBP_SRCSET}
              sizes={LANDING_SKYLINE_HERO_SIZES}
            />
            <img
              className="lpLondonPhoto"
              src={LANDING_SKYLINE_HERO_JPG_FALLBACK}
              width={1600}
              height={1067}
              alt="Tower Bridge and the Thames in London from above"
              decoding="sync"
              loading="eager"
              fetchPriority="high"
            />
          </picture>
          <figcaption className="lpLondonCaption">
            Tower Bridge and the Thames, looking across London.
          </figcaption>
        </figure>
      }
      primary={primary}
      secondary={
        // Two quiet doors on one row. The receipt door comes first, because
        // it was the primary until today and a returning drinker looks for it
        // there; Tonight keeps the tap #1488 gave it.
        <>
          {receipt}
          {LANDING_QUIET_DOORS.map((door) => (
            <Link
              key={door.href}
              prefetch={false}
              href={door.href}
              className={door.className}
              onClick={() => trackLandingCta(door.cta)}
            >
              {door.label}
            </Link>
          ))}
        </>
      }
    >
      {answer ? <AnswerCard answer={answer} near={near} onLocate={locate} photo={photo} /> : null}
      {answer && answer.rail.length > 0 ? <AnswerRail answer={answer} /> : null}
    </Screen>
  );
}

function sourceLine(evidence: Evidence): string {
  if (evidence === "loading") return "Checking who listed it";
  if (evidence === "unavailable") return "Publisher could not be checked";
  return evidence.publisher ? "" : "No publisher recorded";
}

function AnswerCard({
  answer,
  near,
  onLocate,
  photo,
}: {
  answer: Answer;
  near: NearState;
  onLocate: () => void;
  photo: ResolvedLandingPhoto;
}) {
  const kicker = answerKicker(answer.scope, answer.area);
  const walk = answer.walkMinutes != null ? `${answer.walkMinutes} min walk` : null;
  const showControl = near.kind === "idle" || near.kind === "requesting";
  const evidence = answer.evidence;
  const publisher = typeof evidence === "object" ? evidence.publisher : null;
  const standing = typeof evidence === "object" ? evidence.standing : null;
  // The day THIS pub's row was read. No day prints until the evidence names
  // one, and none for a row that records no read.
  const observedOn = typeof evidence === "object" ? evidence.observedOn : null;
  return (
    <article
      className="lpPubCard lpAnswerCard lpPubCard--photo"
      aria-labelledby="lp-answer-name"
    >
      <LandingPhoto
        resolved={photo}
        sizes={ANSWER_PHOTO_SIZES}
        preloadMedia={ANSWER_PHOTO_PRELOAD_MEDIA}
      />
      <div className="lpAnswerHead">
        <Kicker tone="muted">
          {kicker}
          {walk ? <span className="lpAnswerWalk"> · {walk}</span> : null}
        </Kicker>
        {showControl ? (
          <button
            type="button"
            className="lpNearMe"
            onClick={onLocate}
            disabled={near.kind === "requesting"}
            aria-busy={near.kind === "requesting" || undefined}
          >
            <LocateFixed size={15} aria-hidden="true" />
            {near.kind === "requesting" ? NEAR_ME_CONTROL_BUSY_LABEL : NEAR_ME_CONTROL_LABEL}
          </button>
        ) : null}
      </div>
      <h2 className="lpPubName" id="lp-answer-name">
        <Link prefetch={false} href={venueMapUrl(answer.id)}>
          {answer.name}
        </Link>
      </h2>
      <p className="lpPubPrice">
        {/* The figure wears its BAND (lib/priceBand.ts) and nothing else. */}
        <PriceBadge variant="current" band={priceBand(answer.priceGbp, priceBandAreaForVenue(answer.id))}>
          {formatPrice(answer.priceGbp)}
        </PriceBadge>
        {answer.drinkHref ? (
          <Link prefetch={false} href={answer.drinkHref} className="lpPubPint">
            {answer.pintName}
          </Link>
        ) : (
          <span className="lpPubPint">{answer.pintName ?? "cheapest pint"}</span>
        )}
      </p>
      <p className="lpPubSource">
        {publisher ? (
          <>
            Listed by{" "}
            <a href={publisher.url} target="_blank" rel="noopener noreferrer">
              {publisher.label}
            </a>
          </>
        ) : (
          sourceLine(evidence)
        )}
        {observedOn ? `, collected ${collectedDay(observedOn)}` : ""}.
      </p>
      {standing ? (
        <span className="lpStanding" data-standing={standing} title={priceStandingNote(standing)}>
          <span className="lpStandingDot" aria-hidden="true" />
          {priceStandingLabel(standing)}
        </span>
      ) : null}
      {answer.then ? (
        <>
          <p className="lpPubThen">
            <strong>{formatPrice(answer.then.priceGbp)}</strong> in {answer.then.observedMonth}.{" "}
            {priceMovementLine(
              Math.round((answer.priceGbp - answer.then.priceGbp) * 100) / 100,
              answer.then.years,
            )}
          </p>
          <p className="lpPubThenSource">
            <a href={answer.then.source.url} target="_blank" rel="noopener noreferrer">
              {answer.then.source.label}
            </a>
            , {answer.then.observedDay}
          </p>
        </>
      ) : null}
      <p className="lpNearLine" role="status" aria-live="polite">
        {near.kind === "failed" ? near.line : ""}
      </p>
      <LandingPhotoCredit resolved={photo} className="lpPhotoCredit" />
    </article>
  );
}

function AnswerRail({ answer }: { answer: Answer }) {
  return (
    <section className="lpRail" aria-labelledby="lp-rail-title">
      <h2 className="lpRailTitle" id="lp-rail-title">
        {railHeading(answer.scope, answer.area)}
      </h2>
      <ol className="lpRailList">
        {answer.rail.map((row) => (
          <li key={row.id} className="lpRailRow">
            {/* The compose action floats over this row's right cell on a phone,
                and that cell is the price. It takes the control's own lane
                (createFab.css). */}
            <Link prefetch={false} href={pintDropDoorHref(row.id, row.priceGbp)} className="lpRailLink createFabLane">
              <span className="lpRailMain">
                <span className="lpRailName">{row.name}</span>
                {row.walkMinutes != null ? (
                  <span className="lpRailMeta">{row.walkMinutes} min walk</span>
                ) : row.area !== answer.area ? (
                  <span className="lpRailMeta">{row.area}</span>
                ) : null}
              </span>
              <span className="lpRailPrice">
                <PriceBadge variant="neutral" band={priceBand(row.priceGbp, priceBandAreaForVenue(row.id))}>
                  {formatPrice(row.priceGbp)}
                </PriceBadge>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
