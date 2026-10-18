import "server-only";

// "Is it one of these?" before a submission is stored.
//
// A pub the map already has is the commonest wrong submission, so the route
// asks the same matcher the Pubs to try paste uses (curated index, then the UK
// base) before it writes anything, and the drinker confirms. A postcode narrows
// the base hits to its outward code, because "The Crown" alone matches half the
// country. A curated hit carries no address, so it is kept: the curated index
// is London's and small enough to read.

import type { ExistingVenueMatch } from "@/lib/venueSubmissions";
import { resolveWantedPaste } from "@/lib/wantedResolve.server";

const MATCH_LIMIT = 5;
const SEARCH_LIMIT = 12;

export async function existingVenueMatches(
  name: string,
  postcode: string,
): Promise<ExistingVenueMatch[]> {
  const resolved = await resolveWantedPaste(name, SEARCH_LIMIT);
  const outward = postcode.split(" ")[0] ?? "";
  return resolved.candidates
    .filter(
      (candidate) =>
        !outward
        || candidate.venueKind === "curated"
        || candidate.address.toUpperCase().includes(outward),
    )
    .slice(0, MATCH_LIMIT)
    .map((candidate) => ({
      venueId: candidate.venueId,
      venueName: candidate.venueName,
      address: candidate.address || candidate.contextLabel,
    }));
}
