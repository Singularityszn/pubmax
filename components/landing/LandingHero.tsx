"use client";

import Link from "next/link";
import { LocateFixed } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import PriceBadge from "@/components/PriceBadge";
import Kicker from "@/components/ui/kicker";
import Screen from "@/components/ui/screen";
import { trackEvent } from "@/lib/analytics";
import type { LandingCtaTarget } from "@/lib/analyticsEvents";
import {
  answerKicker,
  heroShowsPal,
  heroShowsRail,
  HERO_RAIL_SIZE,
  NEAR_ME_CONTROL_BUSY_LABEL,
  NEAR_ME_CONTROL_LABEL,
  NEAR_ME_FAILED_LINE,
  NEAR_ME_NOTHING_LINE,
  nearAnswerStanding,
  pintDropDoorHref,
  railHeading,
  stillPriceLabel,
  type HeroVariant,
  type LandingAnswerScope,
  type LandingArchiveIndex,
  type LandingArchiveThen,
  type LandingRailRow,
} from "@/lib/landingHero";
import type { LandingPubCardData } from "@/lib/landingPubCard";
import { NEAR_ME_LOCATION_OPTIONS } from "@/lib/nearMeLocation";
import { rankNearMe, type NearMeCard } from "@/lib/nearMeAnswer";
import { startNearPriceTrustRequest } from "@/components/nearme/useNearPriceTrust";
import { priceMovementLine } from "@/lib/priceMovementLine";
import { PRICE_STANDING_TONE, priceStandingLabel, priceStandingNote, type PriceStanding } from "@/lib/priceTier";
import { formatPrice } from "@/lib/venues";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { loadSlimVenuesForCity } from "@/lib/venuesSlim";

// The hero prototype (issue #1357): kicker, the claim, then the ANSWER, then
// the one filled action that acts on it. The DOM order is the phone order; the
// desktop sets the answer beside the copy. Everything the card prints is a
// fact with its source beside it, and the browser only ever swaps the anchor
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
  /** null while the publisher read is in flight; the chip waits for it. */
  standing: PriceStanding | null;
  publisher: { label: string; url: string | null } | null;
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
  // The archive index holds the anchor's own then row with its printed labels;
  // the card's copy is the same row and stays for the share card.
  const then = archive[card.id] ?? null;
  return {
    id: card.id,
    name: card.name,
    area: card.area,
    priceGbp: card.priceGbp,
    pintName: card.pintName,
    scope: "anchor",
    standing: card.standing,
    publisher: card.publisher,
    collectedOn: card.collectedOn,
    then,
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
  const then = archive[first.id] ?? null;
  return {
    id: first.id,
    name: first.name,
    area: first.borough,
    priceGbp: first.cheapestPrice,
    pintName: null,
    scope,
    walkMinutes: first.walkMinutes,
    standing: null,
    publisher: null,
    collectedOn,
    then,
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

export default function LandingHero({
  variant,
  card,
  archive,
  rail,
}: {
  variant: HeroVariant;
  card: LandingPubCardData;
  archive: LandingArchiveIndex;
  rail: LandingRailRow[];
}) {
  const [answer, setAnswer] = useState<Answer>(() => anchorAnswer(card, rail, archive));
  const [near, setNear] = useState<NearState>({ kind: "idle" });
  const generation = useRef(0);

  // The swap. One generation counter keeps a slow first read from landing
  // over a later one, and the publisher read follows the answer rather than
  // holding it: the price prints at once, the chip waits for its evidence.
  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNear({ kind: "failed", line: NEAR_ME_FAILED_LINE });
      return;
    }
    const mine = ++generation.current;
    setNear({ kind: "requesting" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void loadSlimVenuesForCity("london")
          .then((slim) => {
            if (mine !== generation.current) return;
            const ranked = rankNearMe(position.coords.latitude, position.coords.longitude, slim);
            if (ranked.scope === "none" || ranked.cards.length === 0) {
              setNear({ kind: "failed", line: NEAR_ME_NOTHING_LINE });
              return;
            }
            const [first, ...rest] = ranked.cards;
            const next = nearAnswer(first, rest, ranked.scope, archive, card.collectedOn);
            setAnswer(next);
            setNear({ kind: "answered" });
            const request = startNearPriceTrustRequest(
              `/api/near-price-trust?venueId=${encodeURIComponent(first.id)}`,
            );
            void request.promise
              .then((body) => {
                if (mine !== generation.current) return;
                const match = body.results.find(
                  (item) => item.venueId === first.id && item.price === first.cheapestPrice,
                );
                const named = Boolean(match?.publisher);
                setAnswer((current) =>
                  current.id === first.id
                    ? {
                        ...current,
                        standing: nearAnswerStanding(named, card.collectedOn),
                        publisher: match?.publisher ? { label: match.publisher, url: null } : null,
                      }
                    : current,
                );
              })
              .catch(() => {
                if (mine !== generation.current) return;
                setAnswer((current) =>
                  current.id === first.id ? { ...current, standing: "none" } : current,
                );
              });
          })
          .catch(() => {
            if (mine !== generation.current) return;
            setNear({ kind: "failed", line: NEAR_ME_FAILED_LINE });
          });
      },
      () => {
        if (mine !== generation.current) return;
        setNear({ kind: "failed", line: NEAR_ME_FAILED_LINE });
      },
      NEAR_ME_LOCATION_OPTIONS,
    );
  }, [archive, card.collectedOn]);

  // A reader who already said yes gets the near-you answer with no tap. A
  // reader who has not is never asked on arrival: the control below asks.
  useEffect(() => {
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
  }, [locate]);

  const showRail = heroShowsRail(variant) && answer.rail.length > 0;
  const secondary = heroShowsPal(variant) ? (
    <Link prefetch={false} href="/pal" onClick={() => trackLandingCta("pal")}>
      Meet your Pub Pal
    </Link>
  ) : undefined;

  return (
    <Screen
      className={`lpHero lpHeroProto lpHeroProto-${variant}`}
      kicker="PUBMAXX"
      title="What a pint costs, pub by pub."
      titleId="hero-title"
      answer={
        <div className="lpAnswer">
          <AnswerCard answer={answer} near={near} onLocate={locate} />
          {showRail ? <AnswerRail answer={answer} /> : null}
        </div>
      }
      primary={
        <Link
          prefetch={false}
          href={pintDropDoorHref(answer.id)}
          onClick={() => trackLandingCta("receipt")}
          aria-describedby="lp-answer-name"
        >
          {stillPriceLabel(answer.priceGbp)}
        </Link>
      }
      secondary={secondary}
    />
  );
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
        <PriceBadge variant="current">{formatPrice(answer.priceGbp)}</PriceBadge>
        <span className="lpPubPint">{answer.pintName ?? "cheapest pint"}</span>
      </p>
      <p className="lpPubSource">
        {answer.publisher ? (
          <>
            Listed by{" "}
            {answer.publisher.url ? (
              <a href={answer.publisher.url} target="_blank" rel="noopener noreferrer">
                {answer.publisher.label}
              </a>
            ) : (
              answer.publisher.label
            )}
          </>
        ) : answer.standing === null ? (
          "Checking who listed it"
        ) : (
          "No publisher recorded"
        )}
        , collected {collectedDay(answer.collectedOn)}.
      </p>
      {answer.standing ? (
        <span
          className={`lpStanding lpStanding-${PRICE_STANDING_TONE[answer.standing]}`}
          data-standing={answer.standing}
          title={priceStandingNote(answer.standing)}
        >
          <span className="lpStandingDot" aria-hidden="true" />
          {priceStandingLabel(answer.standing)}
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
      <h3 className="lpRailTitle" id="lp-rail-title">
        {railHeading(answer.scope, answer.area)}
      </h3>
      <ol className="lpRailList">
        {answer.rail.map((row) => (
          <li key={row.id} className="lpRailRow">
            <Link prefetch={false} href={pintDropDoorHref(row.id)} className="lpRailLink">
              <span className="lpRailMain">
                <span className="lpRailName">{row.name}</span>
                <span className="lpRailMeta">
                  {row.walkMinutes != null ? `${row.walkMinutes} min walk` : row.area}
                </span>
              </span>
              <span className="lpRailPrice">
                <PriceBadge variant="neutral">{formatPrice(row.priceGbp)}</PriceBadge>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
