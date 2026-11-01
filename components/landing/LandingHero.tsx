"use client";

import type { Route } from "next";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import PriceBadge from "@/components/PriceBadge";
import Kicker from "@/components/ui/kicker";
import Screen from "@/components/ui/screen";
import { trackEvent } from "@/lib/analytics";
import type { LandingCtaTarget } from "@/lib/analyticsEvents";
import {
  answerKicker,
  archiveMovementLine,
  HERO_RAIL_SIZE,
  LANDING_FALLBACK_RECEIPT_HREF,
  LANDING_INTRO,
  LANDING_PRIMARY_HREF,
  LANDING_PRIMARY_LABEL,
  LANDING_QUIET_DOORS,
  LANDING_RECEIPT_LABEL,
  NEAR_ME_FAILED_LINE,
  NEAR_ME_NOTHING_LINE,
  pintDropDoorHref,
  railHeading,
  type AnswerPublisher,
  type LandingAnswerScope,
  type LandingArchiveIndex,
  type LandingArchiveThen,
  type LandingRailRow,
} from "@/lib/landingHero";
import { comparatorEvidenceFor, readLandingEvidence, settleEachRead } from "@/lib/landingEvidenceRead";
import type { LandingPubCardData } from "@/lib/landingPubCard";
import {
  landingPhotoFor,
  type ResolvedLandingPhoto,
} from "@/lib/landingImagery";
import { NEAR_ME_LOCATION_OPTIONS } from "@/lib/nearMeLocation";
import type { NearMeCard } from "@/lib/nearMeAnswer";
import { PRICE_NOT_COMPARED_LINE } from "@/lib/priceMovementLine";
import { priceStandingLabel, priceStandingNote, type PriceStanding } from "@/lib/priceTier";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import {
  LANDING_SKYLINE_HERO_AVIF_SRCSET,
  LANDING_SKYLINE_HERO_JPG_FALLBACK,
  LANDING_SKYLINE_HERO_SIZES,
  LANDING_SKYLINE_HERO_WEBP_SRCSET,
} from "@/lib/landingSkylineHero";
import { formatPrice } from "@/lib/venues";
import { venueMapUrl } from "@/lib/venueMapUrl";

import LandingPhoto, { LandingPhotoCredit } from "./LandingPhoto";

// The landing hero (issue #1357, rebuilt on the captain's 7 Sep 2026 ask, and
// trimmed after the 16 Oct 2026 UX audit): the claim, one line under it, the
// PICTURE, then the one filled action, then the quiet row, then the pub card
// and the three next-cheapest rows. The DOM order is the phone order; the
// desktop seats the picture and the rows beside the copy.
//
// No brand kicker over the claim: the wordmark in the bar already says it, and
// a second PUBMAXX six lines lower was the page repeating its own name.
//
// THE LINE UNDER THE CLAIM IS THE SAVING. "The average listed pint across N
// London pubs is £X. In the cheapest third it's £Y." was the strongest sentence
// on the page and sat mid-scroll as a plain paragraph. It is measured from the
// same priced read the card comes from (lib/pintSavings.ts), never typed, and a
// dataset too small to back it falls back to the map line the share card and
// the meta description carry.
//
// The hero shows the London skyline the captain selected. The responsive files
// are committed under public/landing; the live map is still one tap away.
//
// THE PRIMARY GIVES BEFORE IT ASKS. The receipt door was the primary until
// today and it ends in a sign-in ask, so it is the first QUIET door now and
// /near is the filled one (lib/landingHero.ts).
//
// The pub card under the picture stands on the pub's OWN photograph where we
// hold one, keyed on its venue id, and is a text-and-price card where we hold
// none: a borough or city view behind a pub's name reads as that pub's front
// door. Everything the card prints is a fact with its source beside it, and
// the browser only ever swaps the anchor for a near-you answer built from the
// same slim index /near ranks. lib/landingImagery.ts owns which picture, whose
// it is, and the scrim that keeps every line over it inside WCAG AA.
//
// The card carries no location control of its own. The primary right above it
// is the near-you door, so a second "Near me" inside the card was the same
// promise twice. The swap still happens for a reader whose browser already
// granted location, with no prompt; nobody is asked from the card.

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
  primaryBorough: string;
  priceGbp: number;
  /** "a pint of Pravha" for the anchor; the slim index names no pint. */
  pintName: string | null;
  /** The pint's own drink page, when one publishes (lib/landingPubCard.ts). */
  drinkHref: Route | null;
  scope: LandingAnswerScope;
  walkMinutes?: number;
  /**
   * What the near-you answer is worth against the reader's doorstep pub
   * (nearSavingLine, lib/nearMeAnswer.ts), with that pub's own evidence: the
   * line prints its price, so it prints who listed it and when, or why it
   * cannot. Only an answer from the reader's own fix carries one; the anchor
   * never does.
   */
  saving?: { line: string; name: string; evidence: Evidence } | null;
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
    primaryBorough: card.primaryBorough,
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
  saving: { line: string; name: string } | null,
): Answer {
  return {
    id: first.id,
    name: first.name,
    area: first.borough,
    primaryBorough: first.borough,
    priceGbp: first.cheapestPrice,
    pintName: null,
    drinkHref: null,
    scope,
    walkMinutes: first.walkMinutes,
    saving: saving ? { ...saving, evidence: "loading" } : null,
    evidence: "loading",
    then: archive[first.id] ?? null,
    rail: rest.slice(0, HERO_RAIL_SIZE).map((card) => ({
      id: card.id,
      name: card.name,
      area: card.borough,
      primaryBorough: card.borough,
      priceGbp: card.cheapestPrice,
      walkMinutes: card.walkMinutes,
      hasThen: card.id in archive,
    })),
  };
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
            const nearest = ranked.nearest;
            const savingLine = rankModule.nearSavingLine(ranked.cards, nearest);
            const saving = savingLine && nearest ? { line: savingLine, name: nearest.name } : null;
            setAnswer(nearAnswer(first, rest, ranked.scope, archive, saving));
            setNear({ kind: "answered" });
            const controller = new AbortController();
            // The doorstep pub's evidence is read beside the answer's own, by
            // the same venue read, so the price the saving line prints is as
            // sourced as the card's, and for that exact figure. Each read has
            // its own deadline and lands on its own, so a stalled one cannot
            // hold the other back (lib/landingEvidenceRead.ts).
            const owns = () => mine === generation.current;
            settleEachRead(owns, [
              {
                read: readLandingEvidence(first.id, first.cheapestPrice, controller.signal),
                apply: (evidence) =>
                  setAnswer((current) => (current && current.id === first.id ? { ...current, evidence } : current)),
              },
              ...(saving && nearest
                ? [
                    {
                      read: readLandingEvidence(nearest.id, nearest.cheapestPrice, controller.signal, comparatorEvidenceFor),
                      apply: (evidence: Exclude<Evidence, "loading">) =>
                        setAnswer((current) =>
                          current && current.id === first.id && current.saving
                            ? { ...current, saving: { ...current.saving, evidence } }
                            : current,
                        ),
                    },
                  ]
                : []),
            ]);
          })
          .catch(() => fail(NEAR_ME_FAILED_LINE));
      },
      () => fail(NEAR_ME_FAILED_LINE),
      NEAR_ME_LOCATION_OPTIONS,
    );
  }, [archive, hasCard]);

  // A reader who already said yes gets the near-you answer with no tap. A
  // reader who has not is never asked here: the primary's /near door asks.
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

  // Which picture the card stands on: the pub's own, keyed on its venue id,
  // or none. A borough or city view is never the pub's picture. It follows
  // the ANSWER, so a near-you swap drops a picture the new pub does not have.
  const resolved = answer ? landingPhotoFor({ venueId: answer.id }) : null;
  const photo = resolved?.scope === "pub" ? resolved : null;
  // The one filled action, and it is the same door whether or not a pub card
  // stands behind the document, and the same door for every visitor: /near
  // answers in one tap, and offers the first-run journey there as a chip.
  const primary = (
    <Link
      prefetch={false}
      href={LANDING_PRIMARY_HREF}
      onClick={() => trackLandingCta("near")}
    >
      {LANDING_PRIMARY_LABEL}
    </Link>
  );

  // A general contribution starts with the pub the reader chooses.
  const receipt = (
    <Link
      key="receipt"
      prefetch={false}
      href={LANDING_FALLBACK_RECEIPT_HREF}
      onClick={() => trackLandingCta("receipt")}
    >
      {LANDING_RECEIPT_LABEL}
    </Link>
  );

  return (
    <Screen
      className="lpHero"
      title="What a pint costs, pub by pub."
      titleId="hero-title"
      lede={LANDING_INTRO}
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
        // it was the primary once and a returning drinker looks for it there;
        // Tonight keeps the tap #1488 gave it.
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
      {answer ? <AnswerCard answer={answer} near={near} photo={photo} /> : null}
      {answer && answer.rail.length > 0 ? <AnswerRail answer={answer} /> : null}
    </Screen>
  );
}

function sourceLine(evidence: Evidence): string {
  if (evidence === "loading") return "Checking who listed it";
  if (evidence === "unavailable") return "Publisher could not be checked";
  return evidence.publisher ? "" : "No publisher recorded";
}

/** The doorstep pub's evidence under the saving line, in the card's own words. */
function SavingSource({ name, evidence }: { name: string; evidence: Evidence }) {
  const publisher = typeof evidence === "object" ? evidence.publisher : null;
  const observedOn = typeof evidence === "object" ? evidence.observedOn : null;
  return (
    // lpPubSource: the card's own source line style, link and tap target too.
    <p className="lpPubSource lpSavingSource" data-testid="landing-saving-source">
      {name}:{" "}
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
      {observedOn
        ? `, source read ${collectedDay(observedOn)}`
        : typeof evidence === "object" ? ", read day not recorded" : ""}.
    </p>
  );
}

function AnswerCard({
  answer,
  near,
  photo,
}: {
  answer: Answer;
  near: NearState;
  /** The pub's own photograph, or null for a text-and-price card. */
  photo: ResolvedLandingPhoto | null;
}) {
  const kicker = answerKicker(answer.scope, answer.area);
  const walk = answer.walkMinutes != null ? `${answer.walkMinutes} min walk` : null;
  const evidence = answer.evidence;
  const publisher = typeof evidence === "object" ? evidence.publisher : null;
  const standing = typeof evidence === "object" ? evidence.standing : null;
  // The day THIS pub's row was read. No day prints until the evidence names
  // one, and none for a row that records no read.
  const observedOn = typeof evidence === "object" ? evidence.observedOn : null;
  return (
    // createFabLane: at rest on a phone the compose disc floats over this
    // card's right edge, and "collected 2 October 2026" ran under it (taste
    // plan, 18 Oct 2026), so the card keeps the control's lane.
    <article
      className={
        photo
          ? "lpPubCard lpAnswerCard lpPubCard--photo createFabLane"
          : "lpPubCard lpAnswerCard createFabLane"
      }
      aria-labelledby="lp-answer-name"
    >
      {photo ? (
        <LandingPhoto
          resolved={photo}
          sizes={ANSWER_PHOTO_SIZES}
          preloadMedia={ANSWER_PHOTO_PRELOAD_MEDIA}
        />
      ) : null}
      <div className="lpAnswerHead">
        <Kicker>
          {kicker}
          {walk ? <span className="lpAnswerWalk"> · {walk}</span> : null}
        </Kicker>
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
      {answer.saving ? (
        <>
          <p className="lpSaving" data-testid="landing-saving-line">
            {answer.saving.line}
          </p>
          <SavingSource name={answer.saving.name} evidence={answer.saving.evidence} />
        </>
      ) : null}
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
        {observedOn
          ? `, source read ${collectedDay(observedOn)}`
          : typeof evidence === "object" ? ", read day not recorded" : ""}.
      </p>
      {standing ? (
        <span className="lpStanding" data-standing={standing} title={priceStandingNote(standing)}>
          <span className="lpStandingDot" aria-hidden="true" />
          {priceStandingLabel(standing)}
        </span>
      ) : null}
      {answer.then ? (
        <details className="lpEarlierPrices">
          <summary>Earlier prices</summary>
          <p className="lpPubThen">
            <strong>{formatPrice(answer.then.priceGbp)}</strong> in {answer.then.observedMonth}.{" "}
            {archiveMovementLine(answer.then, answer.priceGbp) ?? PRICE_NOT_COMPARED_LINE}
          </p>
          <p className="lpPubThenSource">
            <a href={answer.then.source.url} target="_blank" rel="noopener noreferrer">
              {answer.then.source.label}
            </a>
            , {answer.then.observedDay}
          </p>
        </details>
      ) : null}
      <p className="lpNearLine" role="status" aria-live="polite">
        {near.kind === "failed" ? near.line : ""}
      </p>
      {photo ? <LandingPhotoCredit resolved={photo} className="lpPhotoCredit" /> : null}
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
                ) : row.primaryBorough !== answer.primaryBorough ? (
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
