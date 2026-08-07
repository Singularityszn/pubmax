import Link from "next/link";
import { useEffect, useMemo } from "react";
import { MapPin } from "lucide-react";

import Disclosure from "@/components/Disclosure";
import PriceBadge from "@/components/PriceBadge";
import { Amenity, ClaimBadge } from "@/components/map/venueInspectorBits";
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
import SaveToListControl from "@/components/savedpubs/SaveToListControl";
import NextBadgeChips from "@/components/profile/NextBadgeChips";
import FirstDropNudge from "@/components/map/inspector/FirstDropNudge";
import VenuePriceEntryPanel from "./VenuePriceEntryPanel";
import VenuePriceThen from "@/components/map/VenuePriceThen";
import VenueWeatherRecommendations from "@/components/map/VenueWeatherRecommendations";
import CommunityPriceReport from "@/components/map/CommunityPriceReport";
import { communityStampLabel, communityTrustNote, submitCategoryLabel } from "@/lib/communityPrice";
import {
  freshestCommunityPrice,
  type CommunityPricesState,
} from "@/components/map/useCommunityPrices";
import VenueActionStrip from "@/components/map/VenueActionStrip";
import CityPlaceStrip from "@/components/map/CityPlaceStrip";
import VenueBuzz from "@/components/map/VenueBuzz";
import VenueAwardBadge from "@/components/areanews/VenueAwardBadge";
import VenueHygiene from "@/components/map/VenueHygiene";
import VenueGettingThere, {
  type LocationRequestStatus,
} from "@/components/map/VenueGettingThere";
import { cuisineTagsForVenue } from "@/lib/cuisineTags";
import type { CityId } from "@/lib/cities";
import type { JourneyPoint } from "@/lib/venueJourney";
import type { CrawlMode } from "@/components/map/ControlRail";
import type { TabKey } from "@/lib/venueInspectorTabs";
import type { PresenceState } from "./usePresence";
import { anchorMonthLabel } from "@/lib/venueAnchorPresentation";
import {
  drinkLensEmptyVenueNote,
  drinkLensPriceNoun,
  NO_ALCOHOL_LENS_PRICE_NOUN,
  type MapExperienceLens,
  type VenuePriceReadStatus,
} from "@/lib/mapExperienceLens";
import {
  CATEGORY_META,
  namedLegacyPintPriceSource,
  type DrinkCategory,
} from "@/lib/drinks";

function VenuePriceSummary({
  venue,
  latestContributorPrice,
  sourcedPrice,
  sourcedObserved,
  anchorStamp,
  onStartFirstDrop,
}: {
  venue: Venue;
  latestContributorPrice: number | null | undefined;
  sourcedPrice: PricedVenue["sourcedPrice"];
  sourcedObserved: string;
  anchorStamp: string | null;
  onStartFirstDrop: () => void;
}) {
  const baselinePriceRow = venue.prices.find(
    (price) => price.price_gbp === venue.cheapestPrice,
  );
  const baselineSource = baselinePriceRow
    ? namedLegacyPintPriceSource(baselinePriceRow)
    : null;

  if (
    !isPubVenue(venue) &&
    venue.anchorLabel &&
    venue.cheapestPrice !== null &&
    venue.cheapestPrice !== undefined
  ) {
    return (
      <div className="contributorPrice">
        <span>
          <ClaimBadge kind="sourced" /> {venue.anchorLabel}
        </span>
        <PriceBadge variant="current">
          {formatPrice(venue.cheapestPrice)}
        </PriceBadge>
        {anchorStamp || venue.anchorSourceUrl ? (
          <small>
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
        <small className="communityPriceNote">Not a pint price.</small>
      </div>
    );
  }

  if (latestContributorPrice !== null && latestContributorPrice !== undefined) {
    return (
      <div className="contributorPrice">
        <span>
          <ClaimBadge kind="contributor" /> Latest Pint Drop price
        </span>
        <PriceBadge variant="current">
          {formatPrice(latestContributorPrice)}
        </PriceBadge>
        {venue.latestContributorAt ? (
          <small>{formatFreshness(venue.latestContributorAt)}</small>
        ) : null}
        <small className="communityPriceNote">{COMMUNITY_PRICE_NOTE}</small>
      </div>
    );
  }

  if (sourcedPrice) {
    return (
      <div className="contributorPrice">
        <span>
          <ClaimBadge kind="sourced" /> Sourced price
        </span>
        <PriceBadge variant="current">
          {formatPrice(venue.cheapestPrice)}
        </PriceBadge>
        <small>
          {sourcedObserved ? `${sourcedObserved} · ` : ""}
          <a
            href={sourcedPrice.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {sourcedPrice.sourceLabel}
          </a>
        </small>
      </div>
    );
  }

  if (venue.cheapestPrice !== null && venue.cheapestPrice !== undefined) {
    return (
      <div className="contributorPrice">
        <span>
          <ClaimBadge kind="baseline" /> Baseline on record
        </span>
        <PriceBadge variant="baseline">
          {formatPrice(venue.cheapestPrice)}
        </PriceBadge>
        <small className="communityPriceNote">
          {baselineSource ? (
            <>
              Dataset price from{" "}
              <a
                href={baselineSource.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {baselineSource.label}
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
      </div>
    );
  }

  return isPubVenue(venue) ? (
    <FirstDropNudge
      venueId={venue.id}
      venueName={venue.name}
      onStartFirstDrop={onStartFirstDrop}
    />
  ) : null;
}

/**
 * The pub has none on record, we are still looking, or we could not look. Only
 * the first is a fact about the pub, so the three never share a sentence.
 */
function noAlcoholEmptyNote(status: VenuePriceReadStatus): string {
  return drinkLensEmptyVenueNote(NO_ALCOHOL_LENS_PRICE_NOUN, status);
}

export default function VenueOverviewTab({
  venue,
  tab,
  cityId,
  mode,
  inCrawl,
  latestContributorPrice,
  latestPintDropAt,
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
  onStartFirstDrop,
  priceEntryAllowed,
  priceSignInRequested,
  priceAuthLoading,
  priceFocusRequest,
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
  /** Opens the existing Pint Drop composer prefilled for this venue (Pints
   *  tab + composer open). Fired by the first-drop nudge on unpriced venues. */
  onStartFirstDrop: () => void;
  priceEntryAllowed: boolean;
  priceSignInRequested: boolean;
  priceAuthLoading: boolean;
  priceFocusRequest: number;
}) {
  // Known-true accessibility facts only (PRD issue #28). Unknown/known-false
  // facets render nothing — never a "No" — per the provenance-honesty rule.
  const accessChips = accessibilityChipLabels(venue);
  const quietHours = quietHoursLabel(venue);

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

  // The ordinary view names the freshest category; the no-alcohol view admits
  // only its two categories, while the food view reserves this slot for the
  // sourced menu anchor below. Sheet visibility remains independent of map
  // authority, which still requires category-specific trust gates.
  const venueReadStatus =
    communityPrices.venuePriceStatus.get(venue.id) ?? "idle";
  const communityRows = communityPrices.byVenueId.get(venue.id);
  const noAlcoholRows = communityRows?.filter(
    (row) =>
      row.drinkCategory === "soft-drink" ||
      row.drinkCategory === "alcohol-free",
  );
  const drinkLensRows = drinkLensCategory
    ? communityRows?.filter((row) => row.drinkCategory === drinkLensCategory)
    : undefined;
  const communityPrice = freshestCommunityPrice(
    experienceLens === "food"
      ? undefined
      : experienceLens === "no-alcohol"
        ? noAlcoholRows
        : drinkLensCategory
          ? drinkLensRows
          : communityRows,
  );
  const drinkLensNoun = drinkLensCategory
    ? drinkLensPriceNoun(drinkLensCategory)
    : null;
  // The sheet is deliberately UNGATED - it shows what people reported, so an
  // uncorroborated or aged-out figure still renders here in full. What changes
  // is that the row admits its standing instead of implying it moved the map.
  const communityTrustStanding = communityPrice ? communityTrustNote(communityPrice) : "";

  // Sourced attribution from mergePriceUpdates (optional field on the runtime
  // venue object). Absent when community is fresher or no refresh exists.
  const sourcedPrice = (venue as PricedVenue).sourcedPrice ?? null;
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
      <VenueActionStrip venue={venue} />
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
      <div className="amenityRow">
        {/* Labels are reader-facing words, not data keys: "0.0" alone read as
            a leaked number and lowercase one-worders read as raw tags (owner
            audit). Sentence case, self-explanatory, still chip-short. */}
        <Amenity active={Boolean(venue.curation.nearWater)} label="Near water" />
        <Amenity active={venue.hasStory} label="Heritage" />
        <Amenity active={Boolean(venue.curation.writerPick)} label="Writer's pick" />
        <Amenity active={venue.amenities.beerGarden} label="Beer garden" />
        <Amenity active={venue.amenities.nonAlcoholic} label="Alcohol-free beer" />
        <Amenity active={venue.amenities.liveSports} label="Live sports" />
        <Amenity active={venue.amenities.food} label="Serves food" />
        <Amenity active={venue.amenities.cocktails} label="Cocktails" />
        <Amenity active={venue.amenities.pubQuiz} label="Pub quiz" />
      </div>
      {venue.amenities.food || cuisineTags.length > 0 ? (
        <div className="cuisineRow" aria-label="Food and cuisine">
          {venue.amenities.food ? (
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
      ) : null}
      {/* Accessibility — only publicly-confirmed facts, shown as chips. A pub
          with no confirmed access facts shows nothing here (never a "No"). */}
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
          <VenueWeatherRecommendations
            key={`weather-recommendations-${venue.id}`}
            venueId={venue.id}
            venueName={venue.name}
          />
          {/* Quest chips show supporting profile progress, not a primary
              decision about this venue. Keep them with the optional detail. */}
          <NextBadgeChips />
      </Disclosure>
      {/* Tonight's community price sits ATOP the price on record, never
          instead of it: its own row, its own dated badge, and the sourced /
          baseline row below still renders untouched. A submission is an extra
          dated observation - it never overwrites a scraped or sourced figure. */}
      {communityPrice ? (
        <div className="contributorPrice communityPriceRow">
          <span>
            <ClaimBadge kind="contributor" /> Logged by a Pubmaxxer
          </span>
          <PriceBadge variant="current">
            {formatPrice(communityPrice.priceGbp)}
          </PriceBadge>
          <small className="communityPriceStamp">
            {submitCategoryLabel(communityPrice.drinkCategory)} ·{" "}
            {communityStampLabel(communityPrice.submittedAt)}
          </small>
          {/* Where this figure stands. A single report shows here in full,
              dated, from the first tap - it just says so plainly rather than
              letting the reader assume the map moved with it. Empty (and so
              unrendered) once the price is corroborated and current. */}
          {communityTrustStanding ? (
            <small className="communityPriceStanding">{communityTrustStanding}</small>
          ) : null}
          <small className="communityPriceNote">{COMMUNITY_PRICE_NOTE}</small>
          {/* Reporting stays public because a reader must be able to challenge
              a displayed observation without becoming a contributor. The flag
              is recorded for a human - it does not hide the row (see
              CommunityPriceReport). */}
          <CommunityPriceReport
            price={communityPrice}
            communityPrices={communityPrices}
            venueName={venue.name}
          />
        </div>
      ) : experienceLens === "no-alcohol" ? (
        <div className="contributorPrice communityPriceRow">
          <span>
            <ClaimBadge kind="baseline" /> No-alcohol prices
          </span>
          <small className="communityPriceNote">
            {noAlcoholEmptyNote(venueReadStatus)}
          </small>
        </div>
      ) : drinkLensCategory && drinkLensNoun ? (
        <div className="contributorPrice communityPriceRow">
          <span>
            <ClaimBadge kind="baseline" />{" "}
            {CATEGORY_META[drinkLensCategory].label} prices
          </span>
          <small className="communityPriceNote">
            {drinkLensEmptyVenueNote(drinkLensNoun, venueReadStatus)}
          </small>
        </div>
      ) : null}
      {/* Price honesty on overview: community override wins, then sourced
          observation, then baseline-on-record. Never imply a live feed.
          Non-pub venues carry a type-specific anchor (a cocktail, a doner) —
          it renders under its own label with date and source, never as a
          pint figure. A selected-drink lens already answered above, so a beer
          baseline must not stand in for coffee (or wine, or soft drink). */}
      {!drinkLensCategory &&
      (experienceLens !== "no-alcohol" ||
        venue.kind === "food" ||
        venue.kind === "restaurant") ? (
        <VenuePriceSummary
          venue={venue}
          latestContributorPrice={latestContributorPrice}
          sourcedPrice={sourcedPrice}
          sourcedObserved={sourcedObserved}
          anchorStamp={anchorStamp}
          onStartFirstDrop={onStartFirstDrop}
        />
      ) : null}
      {/* What a pint here used to cost: one dated figure from the archives,
          against the price on record now. Sits directly under today's price
          because the comparison IS the point. History only - the old figure
          never enters bands, pins, cheapest buckets or the Pint Index
          (lib/priceHistory.ts). Renders nothing for a pub with no history.
          Hidden under a drink lens: an old pint does not answer coffee. */}
      {experienceLens === "all" && !drinkLensCategory ? (
        <VenuePriceThen
          venueId={venue.id}
        // "Now" is only offered where today's figure is a pint. A bar or food
        // venue's cheapestPrice is an anchor price (a cocktail, a dish), so it
        // is withheld rather than compared against an old pint.
          currentPriceGbp={
            isPubVenue(venue) ? (latestContributorPrice ?? venue.cheapestPrice) : null
          }
        />
      ) : null}
      {/* The submission loop itself: pick a drink, type tonight's price, and
          the pin, the list row and the row above restamp on the same tap.
          Pubs only — a Pint Drop at a bar or late-food venue would
          feed a non-pint figure into the pint record. */}
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
            <MapPin size={15} aria-hidden="true" /> You&rsquo;re here 🍺
          </p>
        ) : (
          <button
            type="button"
            className="addStopBtn"
            onClick={markPresenceHere}
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
        {presenceState === "no-handle" ? (
          <p
            className="description muted"
            style={{ marginTop: "8px", fontSize: "0.82rem" }}
          >
            Claim a handle to check in. <Link href="/u/you">Set yours</Link>.
          </p>
        ) : null}
      </div>
    </div>
  );
}
