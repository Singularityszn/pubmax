// The PubMap canvas token source: every map colour derives from the app's theme
// tokens so both modes (candle-lit night / positron day guidebook) flip from one
// system. Extracted verbatim from PubMapCanvas — `readTokens` stays the single
// place the canvas reads CSS custom properties into its `Tokens` shape.

import {
  CATEGORY_COLORS,
  categoryVar,
  type DrinkCategory,
} from "@/lib/categoryColors";

export type Tokens = {
  ink: string;
  inkDeep: string;
  paper: string;
  panelRaised: string;
  line: string;
  muted: string;
  pint: string;
  amber: string;
  brick: string;
  brass: string;
  brassBright: string;
  river: string;
  riverBright: string;
  // Drink-category accents (E5). ADDITIVE — resolves the live `--cat-*` vars
  // (lib/categoryColors.ts) into the map's token object so a future
  // pin-by-category paint tints a pin by a venue's dominant drink family from
  // the SAME light/dark/legacy source the venue-sheet swatches use. Not wired
  // into any live paint yet: the Venue model carries no honest dominant category
  // (see the ready-to-apply patch in components/map/mapColor.css), and the
  // honesty rule is never to colour a pin by a guessed category.
  cat: Record<DrinkCategory, string>;
};

// Every map colour derives from the app's theme tokens so both modes
// (candle-lit night / positron day guidebook) flip from one system.
export function readTokens(): Tokens {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  // Additive `--cat-*` read: one entry per drink family, resolved from the live
  // computed vars (with the canonical light hex as a fallback) so map consumers
  // never re-hardcode a category palette.
  const cat = Object.fromEntries(
    (Object.keys(CATEGORY_COLORS) as DrinkCategory[]).map((c) => [
      c,
      token(categoryVar(c), CATEGORY_COLORS[c].light),
    ]),
  ) as Record<DrinkCategory, string>;
  return {
    cat,
    ink: token("--ink", "#1b2620"),
    inkDeep: token("--ink-deep", "#0f1c16"),
    paper: token("--paper", "#f4efe4"),
    panelRaised: token("--panel-raised", "#ffffff"),
    line: token("--line", "#ddd5c4"),
    muted: token("--muted", "#6b726a"),
    pint: token("--pint", "#2f8f5b"),
    amber: token("--amber", "#d99f45"),
    brick: token("--brick", "#d16353"),
    brass: token("--brass", "#b0813a"),
    brassBright: token("--brass-bright", "#d3a44a"),
    river: token("--river", "#2f6f8f"),
    riverBright: token("--river-bright", "#4f9ec4"),
  };
}

export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
