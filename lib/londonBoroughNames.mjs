// The 32 London boroughs plus the City of London, written down ONCE.
//
// These are the canonical names data/london_boroughs_simplified.json carries,
// the names the point-in-polygon build stamps onto primary_borough, and the
// names every borough page resolves through. They live in plain ESM with a
// .d.mts sidecar (the lib/pintIndexCanonical.mjs idiom) because the app reads
// them from TypeScript while scripts/build_historic_index.mjs and
// scripts/validate-data.mjs read them from plain node, and a second copy is how
// a borough ends up real on one side of the build and unknown on the other.
export const LONDON_BOROUGH_NAMES = Object.freeze([
  "Barking and Dagenham",
  "Barnet",
  "Bexley",
  "Brent",
  "Bromley",
  "Camden",
  "City of London",
  "Croydon",
  "Ealing",
  "Enfield",
  "Greenwich",
  "Hackney",
  "Hammersmith and Fulham",
  "Haringey",
  "Harrow",
  "Havering",
  "Hillingdon",
  "Hounslow",
  "Islington",
  "Kensington and Chelsea",
  "Kingston upon Thames",
  "Lambeth",
  "Lewisham",
  "Merton",
  "Newham",
  "Redbridge",
  "Richmond upon Thames",
  "Southwark",
  "Sutton",
  "Tower Hamlets",
  "Waltham Forest",
  "Wandsworth",
  "Westminster",
]);
