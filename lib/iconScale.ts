// The one icon scale. Every lucide-react icon in app/ and components/ draws at
// one of these sizes and at Lucide's own stroke, and
// __tests__/iconScale.test.ts holds the tree to it. A PURE LEAF importing
// nothing: the fence reads these values, and a component may import them.
//
// Measured on 18 Oct 2026 before the scale landed: 478 icons drew at 23
// different sizes (10 to 44) and 7 stroke widths. Each icon moved to the
// nearest step below. A tie (15, 18, 22) went to the step its role names: an
// icon beside words took the smaller step and an icon alone in a control took
// the larger one.

/** The four sizes, in CSS pixels. */
export const ICON_SIZE = {
  /** Beside small text: meta lines, chips, captions, fine print (--text-2xs to --text-sm). */
  meta: 14,
  /** Beside body text and inside a labelled button, field or heading. */
  inline: 16,
  /** An icon alone in a control: close, overflow, header and tab bar icons. */
  control: 20,
  /** The few large controls, such as full-screen viewer chrome. */
  large: 24,
} as const;

export const ICON_SIZES: readonly number[] = Object.values(ICON_SIZE);

/**
 * The one stroke: Lucide's own default, so no icon passes `strokeWidth`.
 * Chosen over 1.75 from a side-by-side render beside Inter: at 14 and 16px,
 * where three icons in four sit, a 2 stroke draws 1.17 to 1.33px and matches
 * the stem of Inter at those text sizes, and 1.75 drew thinner than the words
 * beside it and greyed out on a dark page.
 */
export const ICON_STROKE = 2;

/**
 * Deliberate display marks: a glyph that stands in for a picture or opens an
 * empty state, not an icon in a line of UI. Each keeps its own size, and
 * nothing else may draw outside the scale. Keyed by file, then
 * "<JSX tag>:<size>".
 */
export const ICON_DISPLAY_MARKS: Readonly<Record<string, readonly string[]>> = {
  // The empty conversation pane on /messages.
  "app/messages/MessagesInboxClient.tsx": ["MessageCircle:44"],
  // The landmark hero when its photograph is missing (also keeps a 1.5 stroke,
  // because a 2 stroke at 40px draws a 3.3px line).
  "components/LandmarkHeroPhoto.tsx": ["LandmarkIcon:40"],
  // The food tile's picture, and its fallback when the photograph is missing.
  "components/drinks/MenuCategoryGrid.tsx": ["UtensilsCrossed:30", "UtensilsCrossed:28"],
  // The camera viewfinder lens in the Spill composer.
  "components/map/composer/SpillCameraStep.tsx": ["Camera:30"],
  // The photo drop zone in the Moment capture.
  "components/moment/MomentCapture.tsx": ["ImagePlus:28", "Upload:28"],
};

/** The display marks allowed a stroke of their own, keyed like ICON_DISPLAY_MARKS. */
export const ICON_DISPLAY_STROKES: Readonly<Record<string, readonly string[]>> = {
  "components/LandmarkHeroPhoto.tsx": ["LandmarkIcon:1.5"],
};
