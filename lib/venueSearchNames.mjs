const BLACKFRIAR_SEARCH_NAMES = ["The Black Friar", "The Black Friar, Blackfriars"];

export function venueSearchNames(venue) {
  return venue.id === "venue-eltcmh"
    ? [venue.name, ...BLACKFRIAR_SEARCH_NAMES]
    : [venue.name];
}
