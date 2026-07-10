// Client-safe map deep-link helper. Kept out of lib/venueIndex.ts so browser
// components never pull in Node `fs` (Turbopack rejects that at build time).

/** Canonical "open this pub on the map" link — `?sel=` selects the venue on load. */
export function venueMapUrl(id: string): string {
  return `/map?sel=${encodeURIComponent(id)}`;
}
