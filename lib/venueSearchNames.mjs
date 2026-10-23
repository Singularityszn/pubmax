const BLACKFRIAR_SEARCH_NAMES = ["The Black Friar", "The Black Friar, Blackfriars"];

// Every name a search may match a venue by. The reader-facing name drops an
// operator suffix (lib/venueDisplay.ts), so the dataset's own name rides along
// as `sourceName` and "wetherspoon" still finds "The George - JD Wetherspoon".
export function venueSearchNames(venue) {
  const names = venue.sourceName ? [venue.name, venue.sourceName] : [venue.name];
  return venue.id === "venue-eltcmh" ? [...names, ...BLACKFRIAR_SEARCH_NAMES] : names;
}
