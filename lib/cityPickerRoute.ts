// Where the city picker lives, and the address it used to have.
//
// A LEAF, importing nothing, because `proxy.ts` reads both strings to 308 the
// old address at the edge and a middleware bundle may not drag the city tables
// behind one path. `lib/places.ts` re-exports PLACES_PATH, so every surface
// still reads the picker's address from the places policy.
export const PLACES_PATH = "/places";

/** The picker's former address. proxy.ts 308s it to PLACES_PATH. */
export const CHOOSE_CITY_PATH = "/choose-city";
