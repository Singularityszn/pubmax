import Link from "next/link";
import { useMemo } from "react";
import { MapPin } from "lucide-react";

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
import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";
import VenuePriceThen from "@/components/map/VenuePriceThen";
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
  NO_ALCOHOL_LENS_PRICE_NOUN,
  type MapExperienceLens,
  type VenuePriceReadStatus,
} from "@/lib/mapExperienceLens";

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
        <strong>{formatPrice(venue.cheapestPrice)}</strong>
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
        <strong>{formatPrice(latestContributorPrice)}</strong>
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
        <strong>{formatPrice(venue.cheapestPrice)}</strong>
        {sourcedObserved ? <small>{sourcedObserved}</small> : null}
      </div>
    );
  }

  if (venue.cheapestPrice !== null && venue.cheapestPrice !== undefined) {
    return (
      <div className="contributorPrice">
        <span>
          <ClaimBadge kind="baseline" /> Baseline on record
        </span>
        <strong>{formatPrice(venue.cheapestPrice)}</strong>
        <small className="communityPriceNote">
          Dataset price. Not a live tonight feed.
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
  if (status === "ready") {
    return `No ${NO_ALCOHOL_LENS_PRICE_NOUN} price logged here yet.`;
  }
  if (status === "degraded") {
    return `We could not read this pub's ${NO_ALCOHOL_LENS_PRICE_NOUN} prices just now.`;
  }
  return `Checking ${NO_ALCOHOL_LENS_PRICE_NOUN} prices logged here.`;
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
  onToggleStop,
  presenceState,
  markPresenceHere,
  userLocation,
  locationRequestStatus,
  onRequestLocation,
  onClearLocation,
  onStartFirstDrop,
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
  const communityPrice = freshestCommunityPrice(
    experienceLens === "food"
      ? undefined
      : experienceLens === "no-alcohol"
        ? noAlcoholRows
        : communityRows,
  );
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
      {/* FSA food hygiene rating (FHRS), matched by postcode + fuzzy name
          server-side. Renders nothing for an unmatched pub. */}
      <VenueHygiene
        venueId={venue.id}
        venueName={venue.name}
        address={venue.address}
      />
      <VenueGettingThere
        userLocation={userLocation}
        venueLocation={{ lat: venue.latitude, lng: venue.longitude }}
        londonTransit={cityId === "london"}
        locationRequestStatus={locationRequestStatus}
        onRequestLocation={onRequestLocation}
        onClearLocation={onClearLocation}
      />
      <VenueActionStrip venue={venue} />
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
        <Amenity active={venue.amenities.nonAlcoholic} label="0.0% beer" />
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
      {/* Tonight's community price sits ATOP the price on record, never
          instead of it: its own row, its own dated badge, and the sourced /
          baseline row below still renders untouched. A submission is an extra
          dated observation - it never overwrites a scraped or sourced figure. */}
      {communityPrice ? (
        <div className="contributorPrice communityPriceRow">
          <span>
            <ClaimBadge kind="contributor" /> Logged by a Pubmaxxer
          </span>
          <strong>{formatPrice(communityPrice.priceGbp)}</strong>
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
          {/* Anyone can log a price here, so anyone must be able to complain
              about one. The flag is recorded for a human - it does not hide the
              row (see CommunityPriceReport). */}
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
      ) : null}
      {/* Price honesty on overview: community override wins, then sourced
          observation, then baseline-on-record. Never imply a live feed.
          Non-pub venues carry a type-specific anchor (a cocktail, a doner) —
          it renders under its own label with date and source, never as a
          pint figure. */}
      {experienceLens !== "no-alcohol" ||
      venue.kind === "food" ||
      venue.kind === "restaurant" ? (
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
          (lib/priceHistory.ts). Renders nothing for a pub with no history. */}
      {experienceLens === "all" ? (
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
        <VenuePriceSubmit
          // Keyed by venue so the chosen drink, the typed price and the receipt
          // never leak across pubs - this instance persists between selections.
          key={venue.id}
          venueId={venue.id}
          venueName={venue.name}
          communityPrices={communityPrices}
          baselinePriceGbp={latestContributorPrice ?? venue.cheapestPrice}
          latestPintDropAt={latestPintDropAt}
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
      {/* Quest chips (IDEAS B2-lite): the viewer's own "next badge" progress,
          resolved from their self-asserted handle (localStorage pubmax_handle)
          inside the component. No handle → renders nothing. */}
      <NextBadgeChips />
    </div>
  );
}
