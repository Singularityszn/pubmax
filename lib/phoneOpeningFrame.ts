// A PHONE OPENS ON ITS FREE MAP, NOT ON ITS CANVAS MIDDLE.
//
// The phone map's canvas fills the screen, but the top chrome covers its top
// 112 px (--mobile-map-chrome-full-h: the bar and the chip row,
// components/mobile/mobileMapShell.css) and the location card covers it from
// 296 px above the foot (components/map/mapArrivalCard.css, on the floating
// stack in components/nav/mobileNav.css). MapLibre aims the camera at the
// canvas middle, so every city opened with its pubs about three quarters of the
// way down the free map. The opening camera is padded to that band instead.
//
// Padding moves the picture, never the camera: the centre, zoom, pitch and
// bearing stay the city's, so the document's opening preview still matches the
// map's first frame. It draws with the same offset (mapOpeningPreview.css).
// The numbers are fixed, measured at 390x844 with no safe area. The location
// card loads on its own and can land after the map is built, so it is never
// measured.

/** The media query that makes a map a phone map, as the camera code reads it. */
export const PHONE_MAP_QUERY = "(max-width: 640px)";

/** The opening camera's padding on a phone: the band between the chrome and the location card. */
export const PHONE_OPENING_PADDING = { top: 112, right: 0, bottom: 296, left: 0 } as const;

/** How far that padding moves the camera's centre from the canvas middle, in px. Negative is up. */
export const PHONE_OPENING_OFFSET_Y = (PHONE_OPENING_PADDING.top - PHONE_OPENING_PADDING.bottom) / 2;

type View = { center: readonly [number, number]; zoom: number; pitch?: number };

/**
 * Whether a map is built on its city's own opening camera, at any bearing (a
 * cold visit opens north-up and turns). A resumed, located or named-area view
 * is the reader's own, and keeps the canvas middle.
 */
export function opensOnCityCamera(view: View, cityView: View): boolean {
  return (
    view.center[0] === cityView.center[0] &&
    view.center[1] === cityView.center[1] &&
    view.zoom === cityView.zoom &&
    (view.pitch ?? 0) === (cityView.pitch ?? 0)
  );
}
