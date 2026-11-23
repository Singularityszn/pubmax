import Link from "next/link";
import { isMapPostcodeQuery } from "@/lib/mapSearchRecovery";
import { addPubHref } from "@/lib/venueSubmissions";

function missHint(postcode: boolean, areaNames: readonly string[]): string {
  const areas = areaNames.join(" or ");
  if (postcode) {
    return areas
      ? `Postcode lookup is not available here. Search for a nearby named area, such as ${areas}.`
      : "Postcode lookup is not available here. Search for a pub by name.";
  }
  return areas
    ? `Try ${areas}. Clear search to see every venue.`
    : "Clear search to see every venue.";
}

export default function MapSearchMissRecovery({ query, areaNames, onChooseArea }: {
  query: string;
  areaNames: readonly string[];
  onChooseArea: () => void;
}) {
  const postcode = isMapPostcodeQuery(query);
  return <>
    <p className="mapSearchSuggestEmptyHint">{missHint(postcode, areaNames)}</p>
    {postcode ? areaNames.length > 0 && (
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

export function MapSearchPostcodeRecovery({ query, areaNames, hasResults, onChooseArea }: {
  query: string;
  areaNames: readonly string[];
  hasResults: boolean;
  onChooseArea: () => void;
}) {
  if (!hasResults || !isMapPostcodeQuery(query)) return null;
  return <div className="mapSearchSuggestEmpty" role="presentation">
    <MapSearchMissRecovery query={query} areaNames={areaNames} onChooseArea={onChooseArea} />
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
