import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MapPin, PlusCircle } from "lucide-react";

import Disclosure from "@/components/Disclosure";
import PriceBadge from "@/components/PriceBadge";
import TrustPill from "@/components/ui/trust-pill";
import { pintPriceSplitLine } from "@/lib/pintDropAgreement";
import {
  LOG_PRICE_DOOR_LABEL,
  overviewPriceDoor,
  trustChipStateFor,
  type OverviewPriceDoor,
} from "@/lib/pintTrust";
import { priceStandingFor, type ConfirmedPriceInput } from "@/lib/priceTier";
import { priceBand, priceBandAreaForVenue, type PriceBandArea } from "@/lib/priceBand";
import { Amenity, ClaimBadge } from "@/components/map/venueInspectorBits";
import { derivedAmenityStatus, type AmenityStatus } from "@/lib/venueTruth";
import { venueAmenityStatus, type VenueAmenityStatus } from "@/lib/venues";
import {
  COMMUNITY_PRICE_NOTE,
  formatFreshness,
  formatObservedAt,
  formatPrice,
  type Venue,
} from "@/lib/venues";
import type { PricedVenue } from "@/lib/priceUpdates";
import {
  accessibilityChipLabels,
  quietHoursLabel,
} from "@/lib/venueAccessibility";
import { isPubVenue } from "@/lib/venueKindFilters";
import {
  AGED_PRICE_LINE,
  PROVISIONAL_PRICE_LINE,
  baselineTrustCaption,
  venueBundlePrices,
  venuePriceLane,
  venuePriceFallbackPending,
  venuePriceLaneIsDrinkerLog,
  venuePriceLaneObservedGbp,
  type DisputedPriceInput,
  type ProvisionalPriceInput,
  type VenuePriceLane,
} from "@/lib/venuePriceLane";
import SaveToListControl from "@/components/savedpubs/SaveToListControl";
import SaveForNightButton from "@/components/wanted/SaveForNightButton";
import NextBadgeChips from "@/components/profile/NextBadgeChips";
import FirstDropNudge from "@/components/map/inspector/FirstDropNudge";
import {
  DROP_READ_UNAVAILABLE_LINE,
  firstDropNudgeMayClaimAbsence,
} from "@/lib/firstDropNudge";
import type { VenueDropReadStatus } from "@/components/map/usePintDrops";
import VenueDrinkPrices from "@/components/map/VenueDrinkPrices";
import VenuePriceEntryPanel from "./VenuePriceEntryPanel";
import VenueSpoonsValueRow from "./VenueSpoonsValueRow";
import { useAuth } from "@/components/auth/AuthProvider";
import { usePriceEvidenceMission } from "@/components/nearme/usePriceEvidenceMission";
import VenueRecordSummary from "./VenueRecordSummary";
import type { PriceEvidenceMission } from "@/lib/priceEvidenceMissions";
import VenueCommunitySignals from "@/components/map/VenueCommunitySignals";
import VenuePriceThen from "@/components/map/VenuePriceThen";
import VenueAreaPriceCompare from "@/components/map/VenueAreaPriceCompare";
import VenueWeatherRecommendations from "@/components/map/VenueWeatherRecommendations";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import VenueActionStrip from "@/components/map/VenueActionStrip";
import CityPlaceStrip from "@/components/map/CityPlaceStrip";
import VenuePlacesDetails from "@/components/map/VenuePlacesDetails";
import VenueSiteDetails from "@/components/map/VenueSiteDetails";
import VenueBuzz from "@/components/map/VenueBuzz";
import VenueAwardBadge from "@/components/areanews/VenueAwardBadge";
import VenueHygiene from "@/components/map/VenueHygiene";
import VenueGettingThere, {
  type LocationRequestStatus,
} from "@/components/map/VenueGettingThere";
import VenueOccupancyRow from "@/components/map/VenueOccupancyRow";
import DiaryLogPanel from "@/components/diary/DiaryLogPanel";
import VisitReportPanel from "@/components/visits/VisitReportPanel";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { cuisineTagsForVenue } from "@/lib/cuisineTags";
import type { CityId } from "@/lib/cities";
import type { JourneyPoint } from "@/lib/venueJourney";
import type { CrawlMode } from "@/components/map/ControlRail";
import type { TabKey } from "@/lib/venueInspectorTabs";
import type { PresenceState } from "./usePresence";
import { useSheetPromptSlot } from "./useSheetPromptSlot";
import { anchorMonthLabel } from "@/lib/venueAnchorPresentation";
import {
  NO_ALCOHOL_LENS_PRICE_NOUN,
  type MapExperienceLens,
  type VenuePriceReadStatus,
} from "@/lib/mapExperienceLens";
import { drinkLaneNoun, venueDrinkPriceView } from "@/lib/drinkLanes";
import { type DrinkCategory } from "@/lib/drinks";
import { overviewDisplayablePintGbp } from "@/lib/overviewDisplayablePint";
import { confirmPintActionName } from "@/lib/pintDropSecondDrinker";
import type { ZonePintIndex } from "@/lib/zones";

/**
 * The ranked evidence mission for THIS pub, read where the Overview decides
 * whether its composer is open. A mission for another venue, a read that has
 * not answered, or a viewer who may not submit all read as no mission.
 */
function useOverviewMission(
  venueId: string,
  pub: boolean,
  priceEntryAllowed: boolean,
): {
  mission: PriceEvidenceMission | null;
  pending: boolean;
  dismiss: (mission: PriceEvidenceMission) => void;
  complete: (mission: PriceEvidenceMission) => void;
} {
  const { user, handle, identityResolved } = useAuth();
  const read = usePriceEvidenceMission({
    venueIds: [venueId],
    enabled: Boolean(pub && identityResolved && user && handle && priceEntryAllowed),
    surface: "map",
  });
  return {
    mission: read.mission?.venueId === venueId ? read.mission : null,
    pending: read.status === "loading",
    dismiss: read.dismiss,
    complete: read.complete,
  };
}

/**
 * Whether the prices-by-drink invite folds away. It is the ONE door only where
 * the price area below renders none: under a drink lens or the no-alcohol
 * view, where that area is hidden. With the area on screen for a pub, or the
 * composer open, a second "Log a beer price" would be the sprawl the door
 * policy removes (lib/pintTrust.ts, `overviewPriceDoor`).
 */
export function drinkInviteOwnedByPriceArea(
  showsPriceSummary: boolean,
  pub: boolean,
  composerOpen: boolean,
): boolean {
  return (showsPriceSummary && pub) || composerOpen;
}

/**
 * Whether the pub's own composer is on screen. A pure reading of four flags
 * the sheet already owns, so the door above the form and the form itself are
 * decided from one answer and can never both stand on one screen.
 *
 * `priceLogged` is the LATCH, and it is why a fourth flag exists: a mission
 * opens the composer, and a logged price now takes the mission away (L02), so
 * without it the composer would fold on the write and take the receipt the
 * drinker just earned off the screen with it. Once this pub's composer has
 * answered, it stays answered.
 */
export function overviewComposerOpen({
  focusRequest,
  signInRequested,
  missionPresent,
  priceLogged = false,
}: {
  focusRequest: number;
  signInRequested: boolean;
  missionPresent: boolean;
  priceLogged?: boolean;
}): boolean {
  return focusRequest > 0 || signInRequested || missionPresent || priceLogged;
}

/**
 * What the price area below the drink rows does on this pub, and whether the
 * block above it may still word an absence.
 *
 * A module-scope helper on purpose: the tab is already at the complexity
 * ceiling, and these are two readings of one decided lane rather than render
 * work. `showsPriceSummary` restates no policy - it is the condition that
 * surface has always rendered under - and `laneLoggedPriceShown` asks
 * `venuePriceLaneIsDrinkerLog` rather than naming lanes itself.
 */
function overviewPriceAreaReach(
  venue: Venue,
  experienceLens: MapExperienceLens,
  drinkLensCategory: DrinkCategory | null | undefined,
  lane: VenuePriceLane | null,
): {
  showsPriceSummary: boolean;
  laneLoggedPriceShown: boolean;
  priceShownFromAnotherLane: boolean;
} {
  const showsPriceSummary =
    !drinkLensCategory &&
    (experienceLens !== "no-alcohol" ||
      venue.kind === "food" ||
      venue.kind === "restaurant");
  // "No beer price logged here yet" may not stand over a drinker's own log
  // (#1426 follow-up). Only a lane a DRINKER logged silences it: a sourced, listed,
  // baseline or modelled figure was logged by nobody, so the line stays true
  // beside those.
  return {
    showsPriceSummary,
    laneLoggedPriceShown:
      showsPriceSummary && lane !== null && venuePriceLaneIsDrinkerLog(lane),
    // A price is on screen but no drinker logged it: the absence line beside it
    // has to say which kind of absence it is.
    priceShownFromAnotherLane:
      showsPriceSummary && lane !== null && !venuePriceLaneIsDrinkerLog(lane),
  };
}

/**
 * THE ONE PRICE DOOR. The Overview's price area offers exactly one price
 * action, decided by `overviewPriceDoor` (lib/pintTrust.ts) over the trust
 * state the chip carries and the lane the area prints, never by a lane branch
 * here. Two kinds, one element: the log door opens the pub's own composer in
 * place and hides once it has (the open composer is then the price action),
 * and the confirm door (#1492) seeds the Pint Drop composer with the figure the
 * lane prints. Renders nothing on a venue that is not a pub, over an anchor
 * lane, or while the composer this door opens is already on screen.
 *
 * The third kind is the SPLIT'S door (captain 7 Sept 2026): a pub holding
 * £4.50 and £4.70 cannot be asked "Still £4.70?", because that names one of two
 * answers and calls the other a correction. It asks "Which did you pay?" and
 * offers one button per recorded figure, each seeding the composer with its own
 * price through the same seam the confirm door uses.
 */
function PriceDoor({
  venue,
  door,
  composerOpen,
  onLogTonightPrice,
  onConfirmPrice,
}: {
  venue: Venue;
  door: OverviewPriceDoor | null;
  composerOpen: boolean;
  onLogTonightPrice: () => void;
  onConfirmPrice?: (priceGbp: number) => void;
}) {
  if (!door || !isPubVenue(venue) || composerOpen) return null;
  if (door.kind === "choose" && onConfirmPrice) {
    return (
      <div className="priceDoorChoice" data-price-door="choose">
        <p className="priceDoorAsk">{door.label}</p>
        <div className="priceDoorOptions">
          {door.prices.map((priceGbp) => (
            <button
              key={priceGbp}
              type="button"
              className="priceDoor"
              data-testid="choose-pint-cta"
              data-price-gbp={priceGbp.toFixed(2)}
              aria-label={confirmPintActionName(priceGbp, venue.name)}
              onClick={() => onConfirmPrice(priceGbp)}
            >
              {formatPrice(priceGbp)}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (door.kind === "confirm" && onConfirmPrice) {
    return (
      <button
        type="button"
        className="priceDoor"
        data-price-door="confirm"
        data-testid="confirm-pint-cta"
        aria-label={confirmPintActionName(door.priceGbp, venue.name)}
        onClick={() => onConfirmPrice(door.priceGbp)}
      >
        {door.label}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="priceDoor"
      data-price-door="log"
      data-testid="log-price-cta"
      aria-label={`${LOG_PRICE_DOOR_LABEL} at ${venue.name}`}
      onClick={onLogTonightPrice}
    >
      <PlusCircle size={15} aria-hidden="true" /> {LOG_PRICE_DOOR_LABEL}
    </button>
  );
}

/**
 * A DRINKER'S OWN LOG, printed with what it is still worth beside it.
 *
 * Three lanes, one block: `provisional` (one in-window report), `disputed`
 * (two or more in-window reports that do not agree) and `aged` (every report
 * past the window). They were three sibling branches in `VenuePriceSummary`,
 * each with its own eyebrow, badge and line, and that is how the split arrived
 * on the Overview worded as a lone report.
 *
 * The figure comes from the ONE reader of a lane's own figure
 * (`venuePriceLaneObservedGbp`), which answers null on a split, so the badge
 * and the band simply do not render there: two prices have no one number and no
 * one colour. `priceStanding` is deliberately not consulted for any of the
 * three, because a drinker's log is not a published price.
 */
function DrinkerLogBlock({
  lane,
  bandArea,
  trustChipAttrs,
  chromeRevealClass,
  priceRevealMotionClass,
  door,
}: {
  lane: VenuePriceLane;
  bandArea: PriceBandArea;
  trustChipAttrs: Record<string, string | undefined>;
  chromeRevealClass: string | undefined;
  priceRevealMotionClass: string;
  door: ReactNode;
}) {
  const split = lane.lane === "disputed" ? lane.split : null;
  const figure = venuePriceLaneObservedGbp(lane);
  const observedAt = lane.lane === "aged" || lane.lane === "provisional" || lane.lane === "disputed"
    ? lane.observedAt
    : null;
  const loggedAt = formatFreshness(observedAt);
  const line = split
    ? pintPriceSplitLine(split)
    : lane.lane === "aged"
      ? AGED_PRICE_LINE
      : PROVISIONAL_PRICE_LINE;
  return (
    <div className="contributorPrice" {...trustChipAttrs}>
      <span className={chromeRevealClass}>
        <ClaimBadge kind="contributor" />{" "}
        {split ? "Logged by PUBMAXXERS" : "Logged by a PUBMAXXER"}
      </span>
      {figure !== null ? (
        <PriceBadge variant="current" band={priceBand(figure, bandArea)}>
          {formatPrice(figure)}
        </PriceBadge>
      ) : null}
      {loggedAt ? <small className={chromeRevealClass}>{loggedAt}</small> : null}
      <small className={`communityPriceStanding ${priceRevealMotionClass}`.trim()}>{line}</small>
      {door}
    </div>
  );
}

/**
 * What the price area says over a pub with no lane to render.
 *
 * A READ WE COULD NOT RUN IS NOT AN EMPTY PUB (review finding F-8). Every
 * first-drop line claims nobody has logged a price here, and that claim needs
 * an answered read behind it. The one door still rides either way, so a reader
 * who came to log a price still can.
 */
function UnpricedPubBlock({
  venue,
  dropReadStatus,
  door,
}: {
  venue: Venue;
  dropReadStatus?: VenueDropReadStatus;
  door: ReactNode;
}) {
  if (firstDropNudgeMayClaimAbsence(dropReadStatus)) {
    return <FirstDropNudge venueId={venue.id}>{door}</FirstDropNudge>;
  }
  return (
    <div className="firstDropNudge" role="note">
      <p className="firstDropNudgeLine">{DROP_READ_UNAVAILABLE_LINE}</p>
      {door}
    </div>
  );
}

function VenuePriceSummary({
  venue,
  lane,
  confirmedPrice,
  sourcedObserved,
  anchorStamp,
  composerOpen,
  dropReadStatus,
  priceReadStatus,
  onLogTonightPrice,
  onConfirmPrice,
  priceRevealMotionClass = "",
}: {
  venue: Venue;
  /** The decided lane, taken once by the tab and never re-decided here, so the
   *  block above and this row cannot answer from two readings of one pub. */
  lane: VenuePriceLane | null;
  confirmedPrice?: ConfirmedPriceInput | null;
  sourcedObserved: string;
  anchorStamp: string | null;
  /** True while the pub's own composer is on screen below, so the log door
   *  folds away rather than standing beside the form it opens. */
  composerOpen: boolean;
  /** Where this pub's own Pint Drop read got to. A failed read may not be
   *  worded as a pub with no price on it (review finding F-8). */
  dropReadStatus?: VenueDropReadStatus;
  priceReadStatus: VenuePriceReadStatus;
  onLogTonightPrice: () => void;
  /** The second drinker's door: opens the Pint Drop composer seeded with the
   *  logged-once figure (lib/pintDropSecondDrinker.ts). */
  onConfirmPrice?: (priceGbp: number) => void;
  priceRevealMotionClass?: string;
}) {
  const chromeRevealClass = priceRevealMotionClass || undefined;
  if (isPubVenue(venue) && venuePriceFallbackPending(lane, priceReadStatus, dropReadStatus)) {
    return <div className="contributorPrice" role="status">Checking prices…</div>;
  }
  // ONE decider. This surface hands over the confirmation lane it owns and
  // reads back a standing; the listed and modelled lanes reach the same call
  // through their own owner rather than through a second judgement here.
  // ONE decider, and it is now handed all three lanes it knows about. The
  // confirmation is this surface's own; the listed and the modelled figure ride
  // in on the venue from the UK price bundle, and `priceStandingFor` decides
  // which of them speaks rather than this component choosing.
  const bundle = venueBundlePrices(venue);
  const priceStanding = priceStandingFor({
    confirmed: confirmedPrice ?? null,
    listed: bundle.listed ?? null,
    estimate: bundle.estimate ?? null,
  });
  // THE TRUST CHIP. Every drop-lane row below carries `data-pint-trust`, the
  // one state lib/pintTrust.ts reads this lane as, so a browser test can hold
  // the chip to the state and the second-drinker action has one thing to mount
  // against. Not a drop lane means no attribute, not "none".
  const trustChipState = trustChipStateFor(lane, priceStanding.standing);
  const trustChipAttrs = trustChipState
    ? { "data-pint-trust": trustChipState, "data-venue-id": venue.id }
    : {};
  // Every figure below wears its price BAND (lib/priceBand.ts) and no other
  // colour; the standing and the lane are said in the badge and the words.
  const bandArea = priceBandAreaForVenue(venue.id);
  // THE ONE DOOR, decided once here and appended to whichever lane block
  // renders, so no lane can grow a second invitation of its own.
  const door = (
    <PriceDoor
      venue={venue}
      door={overviewPriceDoor(trustChipState, lane)}
      composerOpen={composerOpen}
      onLogTonightPrice={onLogTonightPrice}
      onConfirmPrice={onConfirmPrice}
    />
  );

  if (lane?.lane === "anchor") {
    return (
      <div className="contributorPrice">
        <span className={chromeRevealClass}>
          <ClaimBadge kind="sourced" /> {venue.anchorLabel}
        </span>
        {/* NO BAND. An anchor is a cocktail or a course, not a pint, and the
            pint terciles say nothing about it. */}
        <PriceBadge variant="current">
          {formatPrice(venue.cheapestPrice)}
        </PriceBadge>
        {anchorStamp || venue.anchorSourceUrl ? (
          <small className={chromeRevealClass}>
            {anchorStamp}
            {venue.anchorSourceUrl ? (
              <>
                {anchorStamp ? " · " : ""}
                <a
                  href={venue.anchorSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  source
                </a>
              </>
            ) : null}
          </small>
        ) : null}
        <small className={`communityPriceNote ${priceRevealMotionClass}`.trim()}>
          Not a pint price.
        </small>
      </div>
    );
  }

  if (lane?.lane === "contributor") {
    return (
      <div className="contributorPrice" {...trustChipAttrs}>
        <span className={chromeRevealClass}>
          <ClaimBadge kind="contributor" /> Latest Pint Drop price
        </span>
        {/* A confirmed price says the figure and its standing in ONE mark, so
            the number is printed once and by the module that owns the words
            (lib/priceTier.ts). Everything else keeps the badge it always had:
            a lone report waiting for a second drinker is still a price, and
            hanging "No price yet" beside it would be untrue. */}
        {priceStanding.standing === "confirmed" ? (
          <TrustPill decision={priceStanding} area={bandArea} />
        ) : (
          <PriceBadge variant="current" band={priceBand(lane.contributorPrice, bandArea)}>
            {formatPrice(lane.contributorPrice)}
          </PriceBadge>
        )}
        {venue.latestContributorAt ? (
          <small className={chromeRevealClass}>{formatFreshness(venue.latestContributorAt)}</small>
        ) : null}
        <small className={`communityPriceNote ${priceRevealMotionClass}`.trim()}>
          {COMMUNITY_PRICE_NOTE}
        </small>
        {door}
      </div>
    );
  }

  if (lane?.lane === "sourced") {
    return (
      <div className="contributorPrice">
        <span className={chromeRevealClass}>
          <ClaimBadge kind="sourced" /> Sourced price
        </span>
        <PriceBadge variant="current" band={priceBand(venue.cheapestPrice, bandArea)}>
          {formatPrice(venue.cheapestPrice)}
        </PriceBadge>
        <small className={chromeRevealClass}>
          {sourcedObserved ? `${sourcedObserved} · ` : ""}
          <a
            className="priceSourceLink"
            href={lane.sourcedPrice.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {lane.sourcedPrice.sourceLabel}
          </a>
        </small>
        {door}
      </div>
    );
  }

  if (lane?.lane === "listed") {
    return (
      <div className="contributorPrice">
        <span className={chromeRevealClass}>
          <ClaimBadge kind="sourced" /> Published price
        </span>
        {/* The pill says the figure and how far to trust it in ONE mark, and
            the words are the standing module's own. */}
        <TrustPill decision={priceStanding} area={bandArea} />
        <small className={chromeRevealClass}>
          {formatFreshness(lane.listed.observedAt)} ·{" "}
          <a
            className="priceSourceLink"
            href={lane.listed.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            source
          </a>
        </small>
        {door}
      </div>
    );
  }

  // A DRINKER'S OWN LOG, in its three honest endings: one report, two reports
  // that disagree, or a report past the window. One branch and one block,
  // because it is one claim about one pub said three ways, and three sibling
  // branches here is what let the split arrive worded as a lone report.
  if (lane && venuePriceLaneIsDrinkerLog(lane)) {
    return (
      <DrinkerLogBlock
        lane={lane}
        bandArea={bandArea}
        trustChipAttrs={trustChipAttrs}
        chromeRevealClass={chromeRevealClass}
        priceRevealMotionClass={priceRevealMotionClass}
        door={door}
      />
    );
  }

  if (lane?.lane === "baseline") {
    return (
      <div className="contributorPrice">
        <span className={chromeRevealClass}>
          {/* No "Baseline" chip. That word is ours, and it stood immediately
              before the reader's word for the same fact. The heading is now the
              SAME STRING the phone peek prints (battle test M05). */}
          {baselineTrustCaption(lane)}
        </span>
        <PriceBadge variant="baseline" band={priceBand(venue.cheapestPrice, bandArea)}>
          {formatPrice(venue.cheapestPrice)}
        </PriceBadge>
        <small className={`communityPriceNote ${priceRevealMotionClass}`.trim()}>
          {/* The publisher is DECIDED BY THE LANE, through the same reading the
              landing answer card makes, so the peek's caption and this block's
              heading are one string and one publisher (battle test M05). */}
          {lane.publisher ? (
            <>
              Dataset price from{" "}
              <a
                href={lane.publisher.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {lane.publisher.label}
              </a>
              . Not a live tonight feed.
            </>
          ) : (
            <>
              Price on record. Publisher not recorded for this price. Not a live
              tonight feed.
            </>
          )}
        </small>
        {door}
      </div>
    );
  }

  if (lane?.lane === "estimate") {
    return (
      <div className="contributorPrice">
        {/* NO CLAIM BADGE. Nobody published this figure, so nothing here may
            wear the mark that says somebody did. The pill prints "est. £X" and
            carries the method link beside it, and the basis line is left to
            /how-we-estimate rather than restated here in a second vocabulary. */}
        <TrustPill decision={priceStanding} area={bandArea} />
        {door}
      </div>
    );
  }

  return isPubVenue(venue) ? (
    <UnpricedPubBlock venue={venue} dropReadStatus={dropReadStatus} door={door} />
  ) : null;
}

/**
 * The amenity chips this tab may print, in the order a drinker cares about.
 *
 * A curation mark is evidence when it is there and nothing at all when it is
 * not, so it takes `derivedAmenityStatus` rather than a boolean; the pub's own
 * columns take `venueAmenityStatus`, the ONE reading of them. Everything that
 * comes back `unknown` is dropped here, so the row holds only what somebody
 * stated.
 */
function amenityChipsFor(
  venue: Venue,
  status: VenueAmenityStatus,
): Array<{ key: string; label: string; status: AmenityStatus }> {
  return [
    { key: "nearWater", label: "Near water", status: derivedAmenityStatus(Boolean(venue.curation.nearWater)) },
    { key: "heritage", label: "Heritage", status: derivedAmenityStatus(venue.hasStory) },
    { key: "writerPick", label: "Writer's pick", status: derivedAmenityStatus(Boolean(venue.curation.writerPick)) },
    { key: "beerGarden", label: "Beer garden", status: status.beerGarden },
    { key: "nonAlcoholic", label: "Alcohol-free options", status: status.nonAlcoholic },
    { key: "liveSports", label: "Live sports", status: status.liveSports },
    { key: "food", label: "Serves food", status: status.food },
    { key: "cocktails", label: "Cocktails", status: status.cocktails },
    { key: "pubQuiz", label: "Pub quiz", status: status.pubQuiz },
  ].filter((chip) => chip.status !== "unknown");
}

/**
 * The amenity row, or nothing. A venue nobody stated an amenity for renders no
 * row at all rather than an empty box.
 *
 * Labels are reader-facing words, not data keys: "0.0" alone read as a leaked
 * number and lowercase one-worders read as raw tags (owner audit). Sentence
 * case, self-explanatory, still chip-short.
 */
function amenityRow(
  chips: ReadonlyArray<{ key: string; label: string; status: AmenityStatus }>,
) {
  if (chips.length === 0) return null;
  return (
    <div className="amenityRow">
      {chips.map(({ key, label, status }) => (
        <Amenity key={key} status={status} label={label} />
      ))}
    </div>
  );
}

/**
 * What the kitchen is known to do, or nothing. Same shape as the markup it
 * replaces: the sentence prints when food is stated, the chips print when there
 * are any, and a pub with neither renders no row.
 */
function cuisineRow(servesFood: boolean, cuisineTags: readonly string[]) {
  if (!servesFood && cuisineTags.length === 0) return null;
  return (
    <div className="cuisineRow" aria-label="Food and cuisine">
      {servesFood ? (
        <p className="cuisineServes">
          <strong>Serves food</strong>
          {cuisineTags.length === 0
            ? ". Plates available; check the board for tonight’s kitchen."
            : null}
        </p>
      ) : null}
      {cuisineTags.length > 0 ? (
        <div className="cuisineTags">
          {cuisineTags.map((tag) => (
            <span key={tag} className="cuisineChip">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Only publicly-confirmed access facts, shown as chips, plus the quiet-hours
 * line when there is one. A pub with no confirmed access facts shows nothing
 * here, never a "No", per the provenance-honesty rule.
 */
function accessibilityRow(accessChips: readonly string[], quietHours: string | null) {
  if (accessChips.length === 0 && !quietHours) return null;
  return (
    <>
      {accessChips.length > 0 ? (
        <div className="accessibilityChips" aria-label="Confirmed accessibility">
          {accessChips.map((label) => (
            <span key={label} className="accessibilityChip">
              {label}
            </span>
          ))}
        </div>
      ) : null}
      {quietHours ? (
        <p className="accessibilityQuietHours">
          <strong>Quiet hours:</strong> {quietHours}
        </p>
      ) : null}
    </>
  );
}

export default function VenueOverviewTab({
  venue,
  tab,
  cityId,
  mode,
  inCrawl,
  latestContributorPrice,
  latestPintDropAt,
  confirmedPrice,
  provisionalPrice,
  agedPrice,
  disputedPrice,
  dropReadStatus,
  communityPrices,
  experienceLens,
  drinkLensCategory = null,
  onToggleStop,
  presenceState,
  markPresenceHere,
  userLocation,
  locationRequestStatus,
  onRequestLocation,
  onClearLocation,
  onLogTonightPrice,
  onConfirmPrice,
  onOpenVisitReports,
  priceEntryAllowed,
  priceSignInRequested,
  priceAuthLoading,
  priceFocusRequest,
  zoneIndex,
  onLogged,
  priceRevealMotionClass = "",
  revealRecord = false,
  revealRecordLate = false,
  now,
  gettingHome = null,
}: {
  venue: Venue;
  tab: TabKey;
  cityId: CityId;
  mode: CrawlMode;
  inCrawl: boolean;
  latestContributorPrice: number | null | undefined;
  /** Epoch ms of the latest Pint Drop (unmerged drop signal) - lets the
   *  submit receipt refuse to claim the map when a newer drop outranks the
   *  community figure in mergeCommunityPriceSignals. */
  latestPintDropAt?: number | null;
  /** The venue's live Pint Drop confirmation, as `priceStandingFor` takes it,
   *  or null when nobody has confirmed a price here. Read seam only: the
   *  confirmation is minted on the server (lib/pintDropConfirm.server.ts) and
   *  never derived in a render. */
  confirmedPrice?: ConfirmedPriceInput | null;
  /** An in-window pint report that has NOT earned the map, for the price area
   *  alone. It reaches no band, no bucket and no pin figure. */
  provisionalPrice?: ProvisionalPriceInput | null;
  /** A public pint report PAST the window, for the price area alone, so the
   *  area never words an absence over a drop the list below still prints. */
  agedPrice?: ProvisionalPriceInput | null;
  /** The figures this pub's in-window drinkers DISAGREE about, for the price
   *  area alone. Two prices have no one band, so it reaches no pin figure. */
  disputedPrice?: DisputedPriceInput | null;
  /** Where this pub's Pint Drop read got to (review finding F-8). */
  dropReadStatus?: VenueDropReadStatus;
  /** Community price layer - the dated submission row plus the submit card. */
  communityPrices: CommunityPricesState;
  experienceLens: MapExperienceLens;
  /** Selected-drink map lens (e.g. coffee). Never the no-alcohol experience. */
  drinkLensCategory?: DrinkCategory | null;
  onToggleStop: (id: string) => void;
  presenceState: PresenceState;
  markPresenceHere: () => void;
  userLocation: JourneyPoint | null;
  locationRequestStatus: LocationRequestStatus;
  onRequestLocation: () => void;
  onClearLocation: () => void;
  /** The getting-home fold, beside getting there. It was the seventh tab. */
  gettingHome?: ReactNode;
  /** The log door: the community price path, soft-gated by the sheet, which
   *  answers by raising `priceFocusRequest` or `priceSignInRequested`. */
  onLogTonightPrice: () => void;
  /** Opens the Pint Drop composer seeded with a logged-once figure, so a
   *  second drinker can confirm it (lib/pintDropSecondDrinker.ts). */
  onConfirmPrice?: (priceGbp: number) => void;
  /** Opens Lore, where the full Visit Report composer and list live. */
  onOpenVisitReports: () => void;
  priceEntryAllowed: boolean;
  priceSignInRequested: boolean;
  priceAuthLoading: boolean;
  priceFocusRequest: number;
  /** Per-zone median pint index from the map's priced pubs — zone fallback
   *  when the Pint Index league has no borough row for this pub. */
  zoneIndex?: ZonePintIndex | null;
  /** Refresh this venue's Pint Drops after a successful Log it. */
  onLogged?: (venueId: string) => void;
  priceRevealMotionClass?: string;
  revealRecord?: boolean;
  revealRecordLate?: boolean;
  now?: number;
}) {
  // Known-true accessibility facts only (PRD issue #28). Unknown/known-false
  // facets render nothing — never a "No" — per the provenance-honesty rule.
  const accessChips = accessibilityChipLabels(venue);
  const quietHours = quietHoursLabel(venue);

  const amenityStatus = useMemo(() => venueAmenityStatus(venue), [venue]);
  const servesFood = amenityStatus.food === "known-true";
  // The cuisine row below prints "Serves food" in words whenever it is known,
  // so the chip would say it twice on one sheet. The shorter row makes that
  // visible; drop the chip and let the sentence carry it.
  const amenityChips = useMemo(
    () => amenityChipsFor(venue, amenityStatus).filter((chip) => chip.key !== "food"),
    [venue, amenityStatus],
  );

  // Soft cuisine chips (Wave E) — curated id map ∪ searchText keywords.
  const cuisineTags = useMemo(
    () =>
      cuisineTagsForVenue({
        id: venue.id,
        name: venue.name,
        searchText: venue.filterHints?.searchText,
        hintTags: venue.filterHints?.cuisineTags,
      }),
    [venue.id, venue.name, venue.filterHints?.searchText, venue.filterHints?.cuisineTags],
  );

  // This tab makes a claim about what is logged here, so it asks for the read
  // itself rather than inheriting it from the pub-only submit card below: a
  // bar or a restaurant belongs in the no-alcohol view and would otherwise sit
  // for ever on a read that never started.
  const loadVenue = communityPrices.loadVenue;
  useEffect(() => {
    loadVenue(venue.id);
  }, [loadVenue, venue.id]);

  // THE COMPOSER IS FOLDED UNTIL THE DOOR OPENS IT. Three things open it, and
  // every one is already a decision the sheet made: the sheet answered the log
  // door with a focus request, it answered with the sign-in gate, or a ranked
  // evidence mission for this pub arrived (the mission IS the ask, so it opens
  // on its own). The mission read is taken here rather than one component down
  // so the door and the form can never both stand on one screen.
  const pub = isPubVenue(venue);
  const mission = useOverviewMission(venue.id, pub, priceEntryAllowed);
  // The pub whose composer has already taken a price. Kept by venue id rather
  // than as a flag, so selecting another pub starts closed again.
  const [loggedVenueId, setLoggedVenueId] = useState<string | null>(null);
  const promptSlot = useSheetPromptSlot(venue.id, onLogTonightPrice);
  const { logTonightPrice } = promptSlot;
  const composerOpen = overviewComposerOpen({
    focusRequest: priceFocusRequest,
    signInRequested: priceSignInRequested,
    missionPresent: mission.mission !== null,
    priceLogged: loggedVenueId === venue.id,
  });

  // The ordinary view names the freshest category; the no-alcohol view admits
  // only its two categories, while the food view reserves this slot for the
  // sourced menu anchor below. Sheet visibility remains independent of map
  // authority, which still requires category-specific trust gates.
  // The ordinary map, with no drink lens over it. Two blocks below ask the same
  // question, so it is asked once.
  const restingPintView = experienceLens === "all" && !drinkLensCategory;
  const venueReadStatus =
    communityPrices.venuePriceStatus.get(venue.id) ?? "idle";
  const communityRows = communityPrices.byVenueId.get(venue.id);
  // What the prices-by-drink section may show, and which drink it reads first.
  // The food view reserves the slot for the sourced menu anchor below, and the
  // no-alcohol view admits only its own two categories; every other view shows
  // the pub's whole drink list with the map's lane at the top.
  const { rows: drinkPriceRows, lane: leadLane } = venueDrinkPriceView(
    communityRows,
    experienceLens,
    drinkLensCategory,
  );
  // Which lane leads, and what it is called in a sentence. The no-alcohol view
  // joins two categories, so it keeps its own shared noun rather than naming
  // one of them and hiding the other.
  const leadLaneNoun =
    experienceLens === "no-alcohol"
      ? NO_ALCOHOL_LENS_PRICE_NOUN
      : drinkLaneNoun(leadLane);

  const overviewPintGbp = overviewDisplayablePintGbp({
    cheapestPrice: venue.cheapestPrice,
    latestContributorPrice,
    latestPintDropAt,
    communityRows: communityRows,
  });

  // Sourced attribution from mergePriceUpdates (optional field on the runtime
  // venue object). Absent when community is fresher or no refresh exists.
  const sourcedPrice = (venue as PricedVenue).sourcedPrice ?? null;

  // ONE precedence, taken ONCE for this tab and shared with the first-drop gate
  // (lib/venuePriceLane.ts), so a reordered or added lane cannot leave the nudge
  // behind and the two blocks below cannot read one pub two ways.
  const priceLane = venuePriceLane(
    venue,
    latestContributorPrice,
    sourcedPrice,
    venueBundlePrices(venue),
    provisionalPrice,
    agedPrice,
    disputedPrice,
  );
  const { showsPriceSummary, laneLoggedPriceShown, priceShownFromAnotherLane } = overviewPriceAreaReach(
    venue,
    experienceLens,
    drinkLensCategory,
    priceLane,
  );
  const drinkInviteOwnedElsewhere = drinkInviteOwnedByPriceArea(
    showsPriceSummary,
    pub,
    composerOpen,
  );
  const sourcedObserved =
    sourcedPrice?.observedAt != null ? formatObservedAt(sourcedPrice.observedAt) : "";

  const anchorStamp = anchorMonthLabel(venue.anchorObservedAt);

  return (
    <div
      role="tabpanel"
      id="venuePanel-overview"
      aria-labelledby="venueTab-overview"
      className="venueTabPanel"
      hidden={tab !== "overview"}
    >
      <p className="venueAddress">{venue.address}</p>
      <VenueRecordSummary copy={venue.recordCopy} />
      <VenueActionStrip venue={venue} />
      <VenueOccupancyRow
        venueId={venue.id}
        active={tab === "overview"}
        revealRecord={revealRecord}
        revealRecordLate={revealRecordLate}
      />
      {/* The Diary: one tap to log a visit to this pub. Private to its owner. */}
      {isPubVenueKind(venue.kind) ? (
        <DiaryLogPanel venueId={venue.id} venueName={venue.name} />
      ) : null}
      {/* Visit Report peek: newest accounts only. The full composer stays on
          Lore (VenueStoryTab), so Overview never grows a second rating system. */}
      <VisitReportPanel
        venueId={venue.id}
        venueName={venue.name}
        mode="peek"
        active={tab === "overview"}
        onOpenFull={onOpenVisitReports}
      />
      {/* FSA food hygiene rating (FHRS), matched by postcode + fuzzy name
          server-side. Renders nothing for an unmatched pub. Kept above the
          practical-info disclosure so a matched rating is not buried. */}
      <VenueHygiene
        venueId={venue.id}
        venueName={venue.name}
        address={venue.address}
      />
      <Disclosure
        className="venueOverviewMore"
        bodyClassName="venueOverviewMoreBody"
        summary="Details and practical info"
      >
      <VenueGettingThere
        userLocation={userLocation}
        venueLocation={{ lat: venue.latitude, lng: venue.longitude }}
        londonTransit={cityId === "london"}
        locationRequestStatus={locationRequestStatus}
        onRequestLocation={onRequestLocation}
        onClearLocation={onClearLocation}
      />
      <VenuePlacesDetails venue={venue} links />
      <VenueSiteDetails venue={venue} />
      <CityPlaceStrip
        venueId={venue.id}
        venueName={venue.name}
        latitude={venue.latitude}
        longitude={venue.longitude}
        primaryBorough={venue.primaryBorough}
        cityId={cityId}
      />
      {/* "What people say" (task A3) — AI-synthesised third-party buzz via
          CityMCP, honestly labelled. Never community/editorial content. */}
      <VenueBuzz
        venueId={venue.id}
        venueName={venue.name}
        latitude={venue.latitude}
        longitude={venue.longitude}
        primaryBorough={venue.primaryBorough}
        cityId={cityId}
      />
      {/* Fresh-facts layer (Cycle 15 Lane A): an engraved brass plaque when a
          venue-matched award fact exists for this pin. Renders nothing otherwise. */}
      <VenueAwardBadge venueId={venue.id} />
      {amenityRow(amenityChips)}
      {cuisineRow(servesFood, cuisineTags)}
      {accessibilityRow(accessChips, quietHours)}
          <VenueWeatherRecommendations
            key={`weather-recommendations-${venue.id}`}
            venueId={venue.id}
            venueName={venue.name}
          />
          {/* Quest chips show supporting profile progress, not a primary
              decision about this venue. Keep them with the optional detail. */}
          <NextBadgeChips />
      </Disclosure>
      {gettingHome}
      {/* Read-first community observations: character, access and eating sit
          here so drinkers see them without opening price submit. Authoring
          stays on the price-entry path below (VenuePriceEntryPanel). The same
          venue-price read status feeds both, so a failed lookup never words
          as an empty pub. */}
      <VenueCommunitySignals
        venueId={venue.id}
        venueName={venue.name}
        signals={communityPrices.signalsByVenueId.get(venue.id) ?? []}
        readStatus={venueReadStatus}
        now={now}
        readOnly
      />
      {/* Tonight's community prices sit ATOP the price on record, never
          instead of it: their own rows, their own dated badges, and the
          sourced / baseline row below still renders untouched. A submission is
          an extra dated observation - it never overwrites a scraped or sourced
          figure. One row per drink, the map's lane first, so a cocktail map
          never opens a pub on somebody's coffee.
          Reporting stays public on every row because a reader must be able to
          challenge a displayed observation without becoming a contributor. The
          flag is recorded for a human - it does not hide the row. */}
      {experienceLens === "food" ? null : (
        <VenueDrinkPrices
          venueId={venue.id}
          venueName={venue.name}
          rows={drinkPriceRows}
          activeLane={leadLane}
          laneNoun={leadLaneNoun}
          readStatus={venueReadStatus}
          laneLoggedPriceShown={laneLoggedPriceShown}
          priceShownFromAnotherLane={priceShownFromAnotherLane}
          inviteOwnedElsewhere={drinkInviteOwnedElsewhere}
          communityPrices={communityPrices}
          onLogPrice={logTonightPrice}
          canLog={isPubVenue(venue)}
          priceRevealMotionClass={priceRevealMotionClass}
          revealRecord={revealRecord}
          revealRecordLate={revealRecordLate}
        />
      )}
      {/* Price honesty on overview: community override wins, then sourced
          observation, then baseline-on-record. Never imply a live feed.
          Non-pub venues carry a type-specific anchor (a cocktail, a doner) —
          it renders under its own label with date and source, never as a
          pint figure. A selected-drink lens already answered above, so a beer
          baseline must not stand in for coffee (or wine, or soft drink). */}
      {showsPriceSummary ? (
        <VenuePriceSummary
          venue={venue}
          lane={priceLane}
          confirmedPrice={confirmedPrice}
          sourcedObserved={sourcedObserved}
          anchorStamp={anchorStamp}
          composerOpen={composerOpen}
          dropReadStatus={dropReadStatus}
          priceReadStatus={venueReadStatus}
          onLogTonightPrice={logTonightPrice}
          onConfirmPrice={onConfirmPrice}
          priceRevealMotionClass={
            drinkPriceRows?.length ? "" : priceRevealMotionClass
          }
        />
      ) : null}
      {/* What a tenner buys here, when this pub is one of the Wetherspoons the
          Spoons value ranking holds. Sits under today's price because it is a
          different question about the same bar, and renders nothing for every
          other pub. Never a price lane: the figure is a units count somebody
          else read off a menu (lib/spoonsValue.ts). */}
      <VenueSpoonsValueRow venueId={venue.id} visible={restingPintView} />
      {/* What a pint here used to cost: one dated figure from the archives,
          against the price on record now. Sits directly under today's price
          because the comparison IS the point. History only - the old figure
          never enters bands, pins, cheapest buckets or the Pint Index
          (lib/priceHistory.ts). Renders nothing for a pub with no history.
          Hidden under a drink lens: an old pint does not answer coffee. */}
      {restingPintView ? (
        <VenuePriceThen
          venueId={venue.id}
        // "Now" is only offered where today's figure is a pint. A bar or food
        // venue's cheapestPrice is an anchor price (a cocktail, a dish), so it
        // is withheld rather than compared against an old pint.
          currentPriceGbp={isPubVenue(venue) ? overviewPintGbp : null}
        />
      ) : null}
      {/* Patch yardstick: this pint against the borough Pint Index average, or
          the fare-zone median when the Index has no row. Same displayable pint
          stack as the then-and-now block. Renders nothing without a yardstick. */}
      {experienceLens === "all" && isPubVenue(venue) ? (
        <VenueAreaPriceCompare
          priceGbp={overviewPintGbp}
          primaryBorough={venue.primaryBorough}
          zone={venue.zone}
          zoneIndex={zoneIndex}
        />
      ) : null}
      {/* The submission loop itself: pick a drink, type tonight's price, and
          the pin, the list row and the row above restamp on the same tap.
          Pubs only — a Pint Drop at a bar or late-food venue would
          feed a non-pint figure into the pint record. FOLDED until the one
          door above opens it: the panel's effects (the venue read, the viewed
          event) still run, and the form itself mounts only on `composerOpen`. */}
      {isPubVenue(venue) ? (
        <VenuePriceEntryPanel
          // Keyed by venue so the chosen drink, the typed price and the receipt
          // never leak across pubs - this instance persists between selections.
          key={venue.id}
          venueId={venue.id}
          venueName={venue.name}
          communityPrices={communityPrices}
          canSubmitPrice={priceEntryAllowed}
          showSignInGate={priceSignInRequested}
          authLoading={priceAuthLoading}
          baselinePriceGbp={latestContributorPrice ?? venue.cheapestPrice}
          latestPintDropAt={latestPintDropAt}
          focusRequest={priceFocusRequest}
          includeSignals={false}
          open={composerOpen && promptSlot.priceGateOpen(priceSignInRequested)}
          // The composer opens on the drink the map is under, so a cocktail map
          // does not ask a drinker to find cocktails again.
          laneCategory={leadLane}
          mission={mission.mission}
          missionPending={mission.pending}
          onDismissMission={mission.dismiss}
          onMissionFulfilled={mission.complete}
          onLogged={(loggedId) => {
            setLoggedVenueId(loggedId);
            onLogged?.(loggedId);
          }}
        />
      ) : null}
      {mode === "build" && isPubVenue(venue) ? (
        <button
          className="addStopBtn"
          aria-pressed={inCrawl}
          onClick={() => onToggleStop(venue.id)}
        >
          {inCrawl ? "Remove from crawl" : "Add to crawl"}
        </button>
      ) : null}
      <SaveToListControl
        venueId={venue.id}
        venueName={venue.name}
        venueKind={venue.kind}
        open={promptSlot.owner === "list"}
        onOpenChange={(open) => promptSlot.claim(open ? "list" : null)}
      />
      <SaveForNightButton
        venueId={venue.id}
        venueName={venue.name}
        active={promptSlot.allows("night")}
        onActivate={() => promptSlot.claim("night")}
      />
      <div className="presenceHere">
        {presenceState === "here" ? (
          <p
            className="presenceHereConfirm"
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              margin: "12px 0 0",
              minHeight: "42px",
              fontWeight: 700,
              color: "var(--brass)",
            }}
          >
            <MapPin size={15} aria-hidden="true" /> You&rsquo;re here
          </p>
        ) : (
          <button
            type="button"
            className="addStopBtn"
            onClick={() => {
              promptSlot.claim("presence");
              markPresenceHere();
            }}
            disabled={presenceState === "sending"}
            aria-label={`Mark that you're at ${venue.name} tonight`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            <MapPin size={15} aria-hidden="true" />
            {presenceState === "sending" ? "Checking in…" : "I'm here"}
          </button>
        )}
        {presenceState === "no-handle" && promptSlot.owner === "presence" ? (
          <p
            className="description muted"
            style={{ marginTop: "8px", fontSize: "0.82rem" }}
          >
            Claim a handle to check in.{" "}
            <Link href="/u/you" className="sheetPromptLink">
              Set yours
            </Link>
            .
          </p>
        ) : null}
      </div>
    </div>
  );
}
