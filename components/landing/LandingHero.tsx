"use client";

import Link from "next/link";
import { LocateFixed } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import PriceBadge from "@/components/PriceBadge";
import Kicker from "@/components/ui/kicker";
import Screen from "@/components/ui/screen";
import { trackEvent } from "@/lib/analytics";
import type { LandingCtaTarget } from "@/lib/analyticsEvents";
import type { LegacyPintPrice } from "@/lib/drinks";
import {
  answerEvidenceFor,
  answerKicker,
  HERO_RAIL_SIZE,
  LANDING_FALLBACK_PRIMARY_HREF,
  LANDING_FALLBACK_PRIMARY_LABEL,
  NEAR_ME_CONTROL_BUSY_LABEL,
  NEAR_ME_CONTROL_LABEL,
  NEAR_ME_FAILED_LINE,
  NEAR_ME_NOTHING_LINE,
  pintDropDoorHref,
  railHeading,
  stillPriceLabel,
  TONIGHT_DOOR_HREF,
  TONIGHT_DOOR_LABEL,
  type AnswerPublisher,
  type LandingAnswerScope,
  type LandingArchiveIndex,
  type LandingArchiveThen,
  type LandingRailRow,
} from "@/lib/landingHero";
import type { LandingPubCardData } from "@/lib/landingPubCard";
import { NEAR_ME_LOCATION_OPTIONS } from "@/lib/nearMeLocation";
import type { NearMeCard } from "@/lib/nearMeAnswer";
import { priceMovementLine } from "@/lib/priceMovementLine";
import { priceStandingLabel, priceStandingNote, type PriceStanding } from "@/lib/priceTier";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { discardBody } from "@/lib/responseBody";
import { formatPrice } from "@/lib/venues";
import { venueMapUrl } from "@/lib/venueMapUrl";

// The landing hero (issue #1357): kicker, the claim, then the ANSWER, then the
// one filled action that acts on it, the quiet row of the Pal and Tonight
// (#1488), then the three next-cheapest rows. The DOM order is the phone order; the desktop
// seats the answer and the rail beside the copy. Everything the card prints is
// a fact with its source beside it, and the browser only ever swaps the anchor
// for a near-you answer built from the same slim index /near ranks.

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
  | { publisher: AnswerPublisher | null; standing: PriceStanding };

/** What the card prints, whichever lane it came from. */
type Answer = {
  id: string;
  name: string;
  area: string;
  priceGbp: number;
  /** "a pint of Pravha" for the anchor; the slim index names no pint. */
  pintName: string | null;
  scope: LandingAnswerScope;
  walkMinutes?: number;
  evidence: Evidence;
  collectedOn: string;
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
    scope: "anchor",
    evidence: { publisher: card.publisher, standing: card.standing },
    collectedOn: card.collectedOn,
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
  collectedOn: string,
): Answer {
  return {
    id: first.id,
    name: first.name,
    area: first.borough,
    priceGbp: first.cheapestPrice,
    pintName: null,
    scope,
    walkMinutes: first.walkMinutes,
    evidence: "loading",
    collectedOn,
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
  collectedOn: string,
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
    return answerEvidenceFor({ priceGbp, prices, collectedOn });
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
  const collectedOn = card?.collectedOn ?? null;

  // The swap. One generation counter keeps a slow first read from landing
  // over a later one. The ranker and the slim index load only here, so the
  // landing's own bundle never carries them for a reader who never taps.
  const locate = useCallback(() => {
    if (!collectedOn) return;
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
            if (ranked.scope === "none" || ranked.cards.length === 0) {
              fail(NEAR_ME_NOTHING_LINE);
              return;
            }
            const [first, ...rest] = ranked.cards;
            setAnswer(nearAnswer(first, rest, ranked.scope, archive, collectedOn));
            setNear({ kind: "answered" });
            const controller = new AbortController();
            const evidence = await readEvidence(
              first.id,
              first.cheapestPrice,
              collectedOn,
              controller.signal,
            );
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
  }, [archive, collectedOn]);

  // A reader who already said yes gets the near-you answer with no tap. A
  // reader who has not is never asked on arrival: the control on the card asks.
  useEffect(() => {
    if (!collectedOn) return;
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
  }, [collectedOn, locate]);

  const primary = answer ? (
    <Link
      prefetch={false}
      href={pintDropDoorHref(answer.id, answer.priceGbp)}
      onClick={() => trackLandingCta("receipt")}
      aria-describedby="lp-answer-name"
    >
      {stillPriceLabel(answer.priceGbp)}
    </Link>
  ) : (
    <Link
      prefetch={false}
      href={LANDING_FALLBACK_PRIMARY_HREF}
      onClick={() => trackLandingCta("receipt")}
    >
      {LANDING_FALLBACK_PRIMARY_LABEL}
    </Link>
  );

  return (
    <Screen
      className="lpHero"
      kicker="PUBMAXX"
      title="What a pint costs, pub by pub."
      titleId="hero-title"
      answer={answer ? <AnswerCard answer={answer} near={near} onLocate={locate} /> : undefined}
      primary={primary}
      secondary={
        // Two quiet doors on one row. The Pal stays first, the way the captain
        // set the hero; Tonight joins it because the phone had no tap to it at
        // all (#1488) and this row is the last thing above the consent bar.
        <>
          <Link prefetch={false} href="/pal" onClick={() => trackLandingCta("pal")}>
            Meet your Pub Pal
          </Link>
          <Link
            prefetch={false}
            href={TONIGHT_DOOR_HREF}
            className="lpTonightDoor"
            onClick={() => trackLandingCta("tonight")}
          >
            {TONIGHT_DOOR_LABEL}
          </Link>
        </>
      }
    >
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
}: {
  answer: Answer;
  near: NearState;
  onLocate: () => void;
}) {
  const kicker = answerKicker(answer.scope, answer.area);
  const walk = answer.walkMinutes != null ? `${answer.walkMinutes} min walk` : null;
  const showControl = near.kind === "idle" || near.kind === "requesting";
  const evidence = answer.evidence;
  const publisher = typeof evidence === "object" ? evidence.publisher : null;
  const standing = typeof evidence === "object" ? evidence.standing : null;
  return (
    <article className="lpPubCard lpAnswerCard" aria-labelledby="lp-answer-name">
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
        <span className="lpPubPint">{answer.pintName ?? "cheapest pint"}</span>
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
        , collected {collectedDay(answer.collectedOn)}.
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
            <Link prefetch={false} href={pintDropDoorHref(row.id, row.priceGbp)} className="lpRailLink">
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
