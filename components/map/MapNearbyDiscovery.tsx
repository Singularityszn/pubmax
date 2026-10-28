"use client";

import { useMemo } from "react";
import Link from "next/link";
import PriceBadge, { PintPriceBadge } from "@/components/PriceBadge";
import { useAuth } from "@/components/auth/authContext";
import { ReadyButton } from "@/components/ui/ready-button";
import { Button } from "@/components/ui/button";
import type { CityId } from "@/lib/cities";
import { formatGbp } from "@/lib/formatGbp";
import { firstHttp } from "@/lib/httpUrl";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import { mapNearbyPriceForVenue } from "@/lib/mapNearbyPrice";
import { rankMapNearbyRecommendations, resolveMapNearbyFilters, type MapNearbyCard } from "@/lib/mapNearbyRecommendations";
import { formatNearDistance } from "@/lib/nearMeAnswer";
import { useMapNearbyProfile } from "@/lib/useMapNearbyProfile";
import { venueAreaLabel } from "@/lib/venueDisplay";
import { initialFilters, type Filters, type Venue } from "@/lib/venues";

import "./mapNearbyDiscovery.css";

export type MapNearbyDiscoveryProps = {
  cityId: CityId | string;
  venues: Venue[];
  filters: Filters;
  currentFilterKeys?: readonly (keyof Filters)[];
  location: { lat: number; lng: number };
  lensPrices: ReadonlyMap<string, MapLensPrice> | null;
  onSelectVenue: (id: string) => void;
  onApplyFilters?: (filters: Filters) => void;
  /** The map sheet already owns the heading. */
  titledByHost?: boolean;
  hasPintDrops?: (venueId: string) => boolean;
  openNowState?: (venueId: string) => boolean | "unknown";
  wetherspoonsMatchedIds?: ReadonlySet<string>;
};

function PriceSource({ card }: { card: MapNearbyCard }) {
  const { sourceLabel, sourceUrl, observedAt } = card.price;
  const safeUrl = firstHttp(sourceUrl);
  const timestamp = observedAt ? Date.parse(observedAt) : NaN;
  const day = Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }).format(timestamp)
    : null;
  return (
    <p className="mapNearbyDiscoverySource">
      {sourceLabel ? <>
        Source: {safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer">{sourceLabel}</a> : sourceLabel}
        {sourceUrl && !safeUrl ? " · Link unavailable" : null}
      </> : "Publisher not recorded"}
      {day ? ` · ${sourceLabel === "Drinker reports" ? "Reported" : "Read"} ${day}` : " · Date not recorded"}
    </p>
  );
}

function NearbyCard({ card, onSelectVenue }: { card: MapNearbyCard; onSelectVenue: (id: string) => void }) {
  const role = card.roles.length === 2 ? "Cheapest and best match"
    : card.roles[0] === "cheapest" ? "Cheapest match" : "Best match";
  const exactPint = card.price.category === "beer" && card.price.servingKnown === true && card.price.measureLabel === "pint";
  return (
    <article className="mapNearbyDiscoveryCard">
      <p className="mapNearbyDiscoveryRole">{role}</p>
      <ReadyButton className="mapNearbyDiscoverySelect" type="button" onClick={() => onSelectVenue(card.venue.id)} aria-label={`Open ${card.venue.name}`}>
        <span className="mapNearbyDiscoveryPub">
          <strong>{card.venue.name}</strong>
          <span>{venueAreaLabel(card.venue)}</span>
        </span>
        {exactPint ? <PintPriceBadge priceGbp={card.price.priceGbp} venueId={card.venue.id} />
          : <PriceBadge>{formatGbp(card.price.priceGbp)}</PriceBadge>}
      </ReadyButton>
      <p className="mapNearbyDiscoveryDrink">
        {card.price.drinkLabel} · {card.price.servingKnown === false ? "Serving size not recorded" : card.price.measureLabel}
      </p>
      <p className="mapNearbyDiscoveryDistance">
        {formatNearDistance(card.distanceKm)} · about {card.walkMinutes} min walk, estimated
      </p>
      {card.reasons.length ? <p className="mapNearbyDiscoveryReason">{card.reasons.join(" · ")}</p> : null}
      <PriceSource card={card} />
    </article>
  );
}

export default function MapNearbyDiscovery({
  cityId, venues, filters, currentFilterKeys, location, lensPrices, onSelectVenue, onApplyFilters,
  hasPintDrops, openNowState, wetherspoonsMatchedIds, titledByHost = false,
}: MapNearbyDiscoveryProps) {
  const auth = useAuth();
  const accountId = auth.user?.id ?? auth.session?.user.id ?? "account";
  const ownerKey = auth.identityResolved && auth.providerAuthState === "authenticated"
    ? `${accountId}:${auth.accountRevision}` : null;
  const account = useMapNearbyProfile(ownerKey);
  const savedProfile = account.profile?.cityId === cityId ? account.profile : null;
  const savedFilters = resolveMapNearbyFilters(filters, savedProfile, currentFilterKeys).filters;
  const needsSavedDrinkAction = savedFilters.drinkCategory !== filters.drinkCategory
    || savedFilters.requireNonAlcoholic !== filters.requireNonAlcoholic;
  // A different saved drink needs its map lens first. Other saved constraints still apply.
  const activeProfile = useMemo(() => savedProfile && needsSavedDrinkAction ? {
    ...savedProfile,
    context: { ...savedProfile.context, drinkCategory: null, zeroProof: false },
  } : savedProfile, [savedProfile, needsSavedDrinkAction]);
  const answer = useMemo(() => rankMapNearbyRecommendations({
    location, venues, filters, currentFilterKeys, savedProfile: activeProfile,
    hasPintDrops, openNowState, wetherspoonsMatchedIds,
    priceForVenue: (venue, effectiveFilters) => mapNearbyPriceForVenue(venue, effectiveFilters, lensPrices),
  }), [location, venues, filters, currentFilterKeys, activeProfile, lensPrices, hasPintDrops, openNowState, wetherspoonsMatchedIds]);
  const pending = account.status === "loading" || auth.loading
    || auth.providerAuthState === "unresolved"
    || (auth.providerAuthState === "authenticated" && !auth.identityResolved);
  return (
    <section className="mapNearbyDiscovery" aria-label="Nearby pub matches">
      <header className="mapNearbyDiscoveryHeader">
        {titledByHost ? <p className="mapNearbyDiscoveryTitle">Near you</p> : <h2>Near you</h2>}
        <p>{answer.scope === "walkable" ? "Matches within 1 km."
          : answer.scope === "widened" ? "No matching price within 1 km. These are within 2.5 km."
          : "Your current filters, checked within 2.5 km."}</p>
      </header>
      {pending ? <p className="mapNearbyDiscoveryNotice" role="status">Checking saved preferences. These matches use your current filters.</p> : null}
      {account.status === "unavailable" || auth.providerAuthState === "unavailable"
        ? <p className="mapNearbyDiscoveryNotice" role="status">Saved preferences are unavailable. These matches use your current filters.</p> : null}
      {needsSavedDrinkAction ? <div className="mapNearbyDiscoveryNotice">
        <p>Your saved drink choice needs a different map filter.</p>
        {onApplyFilters ? <Button variant="secondary" onClick={() => onApplyFilters(savedFilters)}>Use saved preferences</Button>
          : <Link href="/profile">Review saved preferences</Link>}
      </div> : null}
      {answer.blockedConstraints.length ? <p className="mapNearbyDiscoveryNotice">
        We cannot check these saved needs here: {answer.blockedConstraints.join(", ")}. <Link href="/profile">Review saved preferences</Link>.
      </p> : null}
      {answer.cards.length ? <div className="mapNearbyDiscoveryCards">
        {answer.cards.map((card) => <NearbyCard key={card.venue.id} card={card} onSelectVenue={onSelectVenue} />)}
      </div> : <div className="mapNearbyDiscoveryEmpty">
        <p>No priced pub matches these choices within 2.5 km.</p>
        <div className="mapNearbyDiscoveryActions">
          {onApplyFilters ? <Button variant="secondary" onClick={() => onApplyFilters({ ...initialFilters })}>Clear map filters</Button> : null}
          <Link href="/near">Choose another area</Link>
        </div>
      </div>}
      {answer.cards.length ? <p className="mapNearbyDiscoveryNotice">Distances are straight-line estimates. Walking routes may be longer.</p> : null}
      {savedProfile?.context.wetherspoonsPreferred && !wetherspoonsMatchedIds
        ? <p className="mapNearbyDiscoveryNotice">Your saved Wetherspoon preference could not be checked here.</p> : null}
      {answer.unassessedPreferences.length ? <p className="mapNearbyDiscoveryNotice">
        Not checked here: {answer.unassessedPreferences.join(", ")}. Prices are for the stated serving, not a whole night.
      </p> : null}
    </section>
  );
}
