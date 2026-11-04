// The words and the address of the door to the Pint Compass (/compass), in one
// place for every surface that opens it. A leaf with no imports, so the map's
// own bundle carries three strings rather than the compass's arithmetic.
//
// The label says "Pint compass", never a bare "Compass": the map already has
// one compass (lib/mapCompass.ts), the control that turns the map back to the
// city's attitude, and two controls called Compass would be two promises with
// one name.

export const PINT_COMPASS_HREF = "/compass";
export const PINT_COMPASS_LABEL = "Pint compass";
/** The accessible name starts with the visible label, so speech input finds it. */
export const PINT_COMPASS_DOOR_NAME = "Pint compass: point to the cheapest pint nearby";
