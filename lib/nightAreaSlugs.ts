/** London's hand-curated patches. Every other city's areas are derived below. */
export const LONDON_NIGHT_AREA_SLUGS = [
  "clapham", "victoria", "piccadilly-soho", "canary-wharf", "barnes", "chiswick",
  "shoreditch", "camden", "brixton", "bermondsey-london-bridge", "kings-cross", "islington",
  "dalston", "peckham", "greenwich", "hammersmith", "balham", "marylebone", "richmond", "putney",
] as const;
/** A London patch, for the London-only tables (weather points, late food). */
export type LondonNightAreaSlug = (typeof LONDON_NIGHT_AREA_SLUGS)[number];

/**
 * The areas DERIVED for the other cities out of the OpenStreetMap base layer.
 *
 * Written out here rather than read off the JSON because `NightAreaSlug` is a
 * closed union the whole tree narrows against, and a JSON import widens to
 * `string`. `__tests__/cityNightAreas.test.ts` fails when this list and
 * `public/data/night_areas/uk_cities.json` stop naming the same areas, so the
 * builder cannot add one without it landing here too.
 */
export const DERIVED_NIGHT_AREA_SLUGS = [
  "manchester-city-centre",
  "manchester-shaw-heath",
  "manchester-werneth",
  "manchester-portwood",
  "manchester-chorlton-on-medlock",
  "manchester-heaton-norris",
  "birmingham-city-centre",
  "birmingham-vauxhall",
  "birmingham-moseley",
  "birmingham-hockley-port",
  "birmingham-harborne",
  "birmingham-aston",
  "leeds-city-centre",
  "leeds-armley",
  "leeds-hyde-park",
  "leeds-hunslet",
  "leeds-holbeck",
  "leeds-burmantofts",
  "leeds-kirkstall",
  "bristol-city-centre",
  "bristol-montpelier",
  "bristol-hotwells",
  "bristol-bedminster",
  "bristol-barton-hill",
  "bristol-westbury-park",
  "bristol-eastville",
  "bristol-totterdown",
] as const;

export const NIGHT_AREA_SLUGS = [
  ...LONDON_NIGHT_AREA_SLUGS,
  ...DERIVED_NIGHT_AREA_SLUGS,
] as const;
export type NightAreaSlug = (typeof NIGHT_AREA_SLUGS)[number];
