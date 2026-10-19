// Single source of truth for the screen-width breakpoints. CSS files cannot
// import this, and this build has no `@custom-media` (Tailwind's Lightning CSS
// pass only compiles it in a production build, and only inside one file), so
// every stylesheet writes the figure by hand. `__tests__/breakpoints.test.ts`
// holds every `@media` width in app/ and components/ to the set below; the
// table that explains it is docs/DESIGN_SYSTEM.md > Breakpoints.
//
// Each boundary is ONE line between two layouts. The narrow side reads
// `max-width: <narrowMax>px` and the wide side `min-width: <narrowMax + 1>px`,
// so the two halves never overlap and never leave a gap.
export const BREAKPOINTS = {
  /** The smallest phones (320 to 360): squeeze a row, never redesign it. */
  phoneSmall: { narrowMax: 360, wideMin: 361 },
  /** The tab-bar boundary: at or under 640 the bottom tab bar owns navigation. */
  phone: { narrowMax: 640, wideMin: 641 },
  /** A narrow tablet or a phone on its side: single-column layouts end here. */
  tablet: { narrowMax: 900, wideMin: 901 },
  /** The desktop rail and the map's docked venue drawer start here. */
  desktop: { narrowMax: 1023, wideMin: 1024 },
  /** Wide screens: extra columns and the roomier hero. */
  wide: { narrowMax: 1279, wideMin: 1280 },
} as const;

export type BreakpointName = keyof typeof BREAKPOINTS;

export const MOBILE_MAX_WIDTH = BREAKPOINTS.phone.narrowMax;

/** matchMedia query string for "is this a phone-sized viewport?". */
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;
