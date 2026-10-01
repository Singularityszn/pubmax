"use client";

import CommunityPriceReport from "@/components/map/CommunityPriceReport";
import { priceBand, priceBandAreaForVenue, priceBandClass } from "@/lib/priceBand";
import { ClaimBadge } from "@/components/map/venueInspectorBits";
import PriceBadge from "@/components/PriceBadge";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import {
  communityStampLabel,
  communityTrustNote,
  type CommunityPrice,
} from "@/lib/communityPrice";
import {
  drinkLaneLogActionLabel,
  drinkLaneLogInvite,
  orderVenueDrinkPrices,
} from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";
import PublishedMenuPrices from "@/components/map/PublishedMenuPrices";
import type { ListedCategoryPrice } from "@/lib/listedCategoryPrices";
import {
  drinkLensEmptyVenueNote,
  type VenuePriceReadStatus,
} from "@/lib/mapExperienceLens";
import { COMMUNITY_PRICE_NOTE } from "@/lib/venues";
import { formatPrice } from "@/lib/venues";

import "./venueDrinkPrices.css";

function emptyLaneNote(
  hasCommunityRow: boolean,
  hasOtherLoggedPrice: boolean,
  hasListedQuote: boolean,
  laneNoun: string,
  readStatus: VenuePriceReadStatus,
): string | null {
  if (hasCommunityRow || hasOtherLoggedPrice || (hasListedQuote && readStatus === "ready")) {
    return null;
  }
  return drinkLensEmptyVenueNote(laneNoun, readStatus);
}

/**
 * What drinkers have logged at ONE pub, one row per drink, the map's lane first.
 *
 * The sheet used to print a single community row: the freshest report of any
 * category. So a pub with a pint, a wine and a coffee on record showed one of
 * them, and which one depended on who logged last. A drinker reading a cocktail
 * map got a coffee figure at the top of the pub they had just tapped.
 *
 * Every row carries its OWN drink tag, its own figure, its own date and its own
 * standing, so no ordering can make one drink answer for another. The lane only
 * decides which row is read first, and its absence is what earns the one line
 * inviting a contribution.
 *
 * Deliberately UNGATED, like the row it replaces: this is what people reported,
 * so an uncorroborated or aged-out figure still shows here in full. What it
 * never does is imply the map moved with it - `communityTrustNote` says where
 * each figure actually stands.
 */
export default function VenueDrinkPrices({
  venueId,
  venueName,
  rows,
  listedPrices,
  activeLane,
  laneNoun,
  readStatus,
  laneLoggedPriceShown = false,
  inviteOwnedElsewhere = false,
  communityPrices,
  onLogPrice,
  canLog,
  priceRevealMotionClass = "",
  revealRecord = false,
  revealRecordLate = false,
}: {
  venueId: string;
  venueName: string;
  /** The pub's freshest community price per drink, unfiltered by trust. */
  rows: readonly CommunityPrice[] | undefined;
  /** Separately sourced menu quotes. Null means the bundle read failed. */
  listedPrices?: readonly ListedCategoryPrice[] | null;
  /** The drink the map is under. Its row leads; its absence is the invite. */
  activeLane: DrinkCategory;
  /** That lane inside a sentence: "no cocktail price logged here yet". */
  laneNoun: string;
  /** Still reading, could not read, or read and found none: three findings. */
  readStatus: VenuePriceReadStatus;
  /**
   * True when the price area below already prints a DRINKER'S OWN log for this
   * lane, as `venuePriceLaneIsDrinkerLog` decides it (lib/venuePriceLane.ts).
   *
   * A Pint Drop is a log, so "No beer price logged here yet" over one is untrue
   * (#1426 follow-up). The block holds that line rather than printing the figure a second
   * time, because one pub may never offer the same price twice.
   */
  laneLoggedPriceShown?: boolean;
  /**
   * True when the Overview's price area below already renders the ONE price
   * door for this pub, or the composer that door opens is on screen. The
   * absence line stays; the invite and its button fold away, because the
   * captain's rule is one primary per screen (lib/pintTrust.ts,
   * `overviewPriceDoor`). Under a drink lens the area is hidden, so this block
   * keeps the lane's own door.
   */
  inviteOwnedElsewhere?: boolean;
  communityPrices: CommunityPricesState;
  /** Bring the composer under the reader's thumb, already on this drink. */
  onLogPrice: () => void;
  /** False where this venue takes no community price (a bar, a restaurant). */
  canLog: boolean;
  priceRevealMotionClass?: string;
  revealRecord?: boolean;
  revealRecordLate?: boolean;
}) {
  const ordered = orderVenueDrinkPrices(rows, activeLane);
  const [lead, ...rest] = ordered;
  // Pint price bands apply to beer only; other categories stay unbanded.
  const bandArea = priceBandAreaForVenue(venueId);
  const beerBand = (category: string, priceGbp: number) =>
    category === "beer" ? priceBand(priceGbp, bandArea) : null;
  const laneRow = ordered.find((row) => row.inActiveLane) ?? null;
  const orderedListed = listedPrices?.length
    ? [...listedPrices].sort((left, right) =>
        Number(right.category === activeLane) - Number(left.category === activeLane),
      )
    : [];
  const listedLanePresent = orderedListed.some((quote) => quote.category === activeLane);
  // Keep loading and degraded reads distinct from "no price logged".
  const laneEmptyNote = emptyLaneNote(
    Boolean(laneRow),
    laneLoggedPriceShown,
    listedLanePresent,
    laneNoun,
    readStatus,
  );
  const invite =
    laneRow || laneLoggedPriceShown || listedLanePresent || !canLog || inviteOwnedElsewhere
      ? null
      : drinkLaneLogInvite(
          laneNoun,
          // The venue read is all or nothing. It returns every row or none.
          readStatus,
        );

  if (!lead && !laneEmptyNote && orderedListed.length === 0 && listedPrices !== null) return null;

  return (
    <section
      className="venueDrinkPrices"
      aria-label={`Drink prices at ${venueName}`}
    >
      {lead ? (
        <div className="contributorPrice communityPriceRow">
          <span className={priceRevealMotionClass || undefined}>
            <ClaimBadge kind="contributor" /> Logged by a PUBMAXXER
          </span>
          <PriceBadge variant="current" band={beerBand(lead.category, lead.price.priceGbp)}>
            {formatPrice(lead.price.priceGbp)}
          </PriceBadge>
          <small
            className={
              [
                "communityPriceStamp",
                priceRevealMotionClass,
                revealRecord ? "venueRevealRecord" : "",
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
            data-reveal-delay={revealRecord && !revealRecordLate ? "0" : undefined}
          >
            {lead.label} · {communityStampLabel(lead.price.submittedAt)}
          </small>
          {communityTrustNote(lead.price) ? (
            <small
              className={
                [
                  "communityPriceStanding",
                  priceRevealMotionClass,
                  revealRecord ? "venueRevealRecord" : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              data-reveal-delay={revealRecord && !revealRecordLate ? "1" : undefined}
            >
              {communityTrustNote(lead.price)}
            </small>
          ) : null}
          <small className={`communityPriceNote ${priceRevealMotionClass}`.trim()}>
            {COMMUNITY_PRICE_NOTE}
          </small>
          <CommunityPriceReport
            price={lead.price}
            communityPrices={communityPrices}
            venueName={venueName}
          />
        </div>
      ) : null}

      {/* Other drinks keep their own label, date, and trust note. */}
      {rest.length > 0 ? (
        <ul className="venueDrinkPricesList">
          {rest.map((row) => {
            const standing = communityTrustNote(row.price);
            return (
              <li key={`${venueId}-${row.category}`} className="venueDrinkPriceRow">
                <span className="venueDrinkPriceTag">{row.label}</span>
                <span
                  className={`venueDrinkPriceFigure ${priceBandClass(beerBand(row.category, row.price.priceGbp))}`.trim()}
                >
                  {formatPrice(row.price.priceGbp)}
                </span>
                <span className="venueDrinkPriceStamp">
                  {communityStampLabel(row.price.submittedAt)}
                </span>
                {standing ? (
                  <span className="venueDrinkPriceStanding">{standing}</span>
                ) : null}
                <CommunityPriceReport
                  price={row.price}
                  communityPrices={communityPrices}
                  venueName={venueName}
                />
              </li>
            );
          })}
        </ul>
      ) : null}

      <PublishedMenuPrices prices={orderedListed} unavailable={listedPrices === null} />

      {laneEmptyNote ? (
        <div className="venueDrinkPricesEmpty">
          <p className="venueDrinkPricesEmptyNote" role="status">
            {listedLanePresent && readStatus === "degraded"
              ? "Could not read drinker-logged prices just now."
              : laneEmptyNote}
          </p>
          {invite ? (
            <>
              <p className="venueDrinkPricesInvite">{invite}</p>
              <button
                type="button"
                className="venueDrinkPricesLog"
                onClick={onLogPrice}
              >
                {drinkLaneLogActionLabel(laneNoun)}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
