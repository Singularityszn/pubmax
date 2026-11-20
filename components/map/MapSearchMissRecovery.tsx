import Link from "next/link";
import { isMapPostcodeQuery } from "@/lib/mapSearchRecovery";
import { addPubHref } from "@/lib/venueSubmissions";

export default function MapSearchMissRecovery({ query, onChooseArea }: {
  query: string;
  onChooseArea: () => void;
}) {
  const postcode = isMapPostcodeQuery(query);
  return <>
    <p className="mapSearchSuggestEmptyHint">
      {postcode
        ? "Postcode lookup is not available here. Search for a nearby named area, such as Soho or Willesden."
        : "Try Soho, Willesden, or The Crown. Clear search to see every venue."}
    </p>
    {postcode ? (
      <button type="button" className="mapSearchSuggestEmptyAdd" onClick={onChooseArea}>
        Choose a named area
      </button>
    ) : (
      <Link href={addPubHref(query)} prefetch={false} className="mapSearchSuggestEmptyAdd" data-testid="map-search-add-pub">
        Know a pub we&apos;re missing? Add it
      </Link>
    )}
  </>;
}

export function MapSearchPostcodeRecovery({ query, hasResults, onChooseArea }: {
  query: string;
  hasResults: boolean;
  onChooseArea: () => void;
}) {
  if (!hasResults || !isMapPostcodeQuery(query)) return null;
  return <div className="mapSearchSuggestEmpty" role="presentation">
    <MapSearchMissRecovery query={query} onChooseArea={onChooseArea} />
  </div>;
}

export function MapSearchPalHandoff({ query, settled, noResults }: {
  query: string;
  settled: boolean;
  noResults: boolean;
}) {
  if (!query || query.length > 500 || !(noResults || (settled && query.split(/\s+/).length >= 4))) return null;
  return <Link prefetch={false} className="mapSearchSuggestPal" href={`/pal/chat?draft=${encodeURIComponent(query)}`}>
    Ask Pub Pal
  </Link>;
}
