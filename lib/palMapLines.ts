// What the Pal says on the map, in its speech bubble (`say` in
// components/map/canvas/palMarker.ts). Every line reads a fact the map itself
// already shows: the time bubble on the leg it sets off on (routeLegTimes in
// components/map/canvas/geojson.ts), or a pin painted in the cheapest band
// (palPinIsCheap). So the Pal never names a price, a pub or a time the map
// does not, never shouts, and never asks for a drink.
//
// A few lines take turns so the Pal does not repeat itself, but the same place
// always gets the same line (`pick`), so a re-render never changes its mind.

function pick(lines: readonly string[], key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return lines[Math.abs(hash) % lines.length]!;
}

/** The time bubble's label on the first leg of a route's leg times: "7 min" or "~7 min". */
export function palFirstLegLabel(legTimes: GeoJSON.FeatureCollection): string | null {
  const label = legTimes.features[0]?.properties?.label;
  return typeof label === "string" && /^~?\d+ min$/.test(label) ? label : null;
}

/** Setting off on a crawl: the first leg's own time, as its bubble prints it. */
export function palWalkLine(legLabel: string | null, key: string): string | null {
  if (!legLabel) return null;
  // "~7 min" is a straight-line estimate, so the Pal says it as one.
  const time = legLabel.startsWith("~") ? `About ${legLabel.slice(1)}` : legLabel;
  return pick([`${time} to the next pub. Race you.`, `${time} on foot. I'll wait at the door.`, `${time} to the next one. Stretch first.`], key);
}

/** Beside a pin painted in the cheapest band, where the Pal already lands with a hop. */
export function palCheapPerchLine(key: string): string {
  return pick(["In the cheapest band. Nice find.", "Green pin. My favourite colour.", "This one's in the cheap band. Noted."], key);
}

/**
 * What the Pal says beside the pin it perches at, given what it last spoke
 * about (`spoken`: the cheap pub's id, or "" for nothing). A new cheap pub
 * gets its line; leaving a cheap pub, for another pub or none, or that pub's
 * pin leaving the cheapest band, takes the line back (null), so a claim never
 * stays beside a pin it is not true of. Anything else says nothing new.
 */
export function palPerchSpeech(
  spoken: string,
  venueId: string | null,
  cheap: boolean,
): { spoken: string; say?: string | null } {
  const next = venueId && cheap ? venueId : "";
  if (next === spoken) return { spoken };
  return { spoken: next, say: next ? palCheapPerchLine(next) : null };
}

/**
 * The perch line from the pin's own data: the cheap-band line only for a pin
 * whose PRICE is in the cheapest band (`bucket` 0). Under the Spoons value
 * lens a green pin (`spoonsBucket` 0) means the most units for a round, not a
 * low price, so the Pal claims no cheap band there (and takes back a line it
 * said before the lens came on). The pin's happy hop still reads the painted
 * band (palPinIsCheap); only the words need the price.
 */
export function palPerchSpeechForPin(
  spoken: string,
  venueId: string | null,
  pin: { bucket?: unknown; spoonsBucket?: unknown } | null | undefined,
): { spoken: string; say?: string | null } {
  const lensOn = pin?.spoonsBucket !== undefined && pin?.spoonsBucket !== null;
  return palPerchSpeech(spoken, venueId, !lensOn && pin?.bucket === 0);
}

