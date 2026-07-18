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
import SaveToListControl from "@/components/savedpubs/SaveToListControl";
import NextBadgeChips from "@/components/profile/NextBadgeChips";
import FirstDropNudge from "@/components/map/inspector/FirstDropNudge";
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

export default function VenueOverviewTab({
  venue,
  tab,
  cityId,
  mode,
  inCrawl,
  latestContributorPrice,
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

  // Sourced attribution from mergePriceUpdates (optional field on the runtime
  // venue object). Absent when community is fresher or no refresh exists.
  const sourcedPrice = (venue as PricedVenue).sourcedPrice ?? null;
  const sourcedObserved =
    sourcedPrice?.observedAt != null ? formatObservedAt(sourcedPrice.observedAt) : "";

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
      {/* Price honesty on overview: community override wins, then sourced
          observation, then baseline-on-record. Never imply a live feed. */}
      {latestContributorPrice !== null && latestContributorPrice !== undefined ? (
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
      ) : sourcedPrice ? (
        <div className="contributorPrice">
          <span>
            <ClaimBadge kind="sourced" /> Sourced price
          </span>
          <strong>{formatPrice(venue.cheapestPrice)}</strong>
          {sourcedObserved ? <small>{sourcedObserved}</small> : null}
        </div>
      ) : venue.cheapestPrice !== null && venue.cheapestPrice !== undefined ? (
        <div className="contributorPrice">
          <span>
            <ClaimBadge kind="baseline" /> Baseline on record
          </span>
          <strong>{formatPrice(venue.cheapestPrice)}</strong>
          <small className="communityPriceNote">
            Dataset price. Not a live tonight feed.
          </small>
        </div>
      ) : (
        /* No price on any honest source — the 658-unpriced case. Instead of a
           blank slot, invite the first Pint Drop for this venue (Cycle-8 item
           3). This else-branch is exactly isVenueUnpriced(venue, price). */
        <FirstDropNudge
          venueId={venue.id}
          venueName={venue.name}
          onStartFirstDrop={onStartFirstDrop}
        />
      )}
      {mode === "build" ? (
        <button
          className="addStopBtn"
          aria-pressed={inCrawl}
          onClick={() => onToggleStop(venue.id)}
        >
          {inCrawl ? "Remove from crawl" : "Add to crawl"}
        </button>
      ) : null}
      <SaveToListControl venueId={venue.id} venueName={venue.name} />
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
