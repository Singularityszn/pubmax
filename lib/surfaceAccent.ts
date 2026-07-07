// surfaceAccent — shared, PURE helpers for painting non-drink surfaces (landing,
// nav) with the drink-category colour language (Epic E5, design pass D1).
// ---------------------------------------------------------------------------
// The thesis: "every pint has a story — and every drink has a colour." The 8
// drink-category hues (lib/categoryColors.ts / the `--cat-*` tokens) become the
// app's colour language. This module is the small, tested seam other surfaces
// reuse so the colour choices are consistent and legible rather than ad-hoc:
//
//   · CATEGORY_ROTATION      — a fixed, aesthetically ordered category cycle
//   · rotateCategory(i)      — pick the i-th category in that cycle (wraps)
//   · WEDGE_CATEGORY         — the landing "wedge" card → category mapping
//   · wedgeCategory(key)     — resolve a wedge slot to its category
//   · categoryGradient(cat)  — a SUBTLE 2-stop CSS gradient on the ink/paper base
//   · categoryTint(cat, pct) — a single color-mix() tint of a category on a base
//
// PURE + browser-safe: no imports beyond the category type + token helper, no
// node builtins, no DOM. Every string it returns references a `--cat-*` token
// (via categoryColor) or a passed-in base token — NEVER a literal hex — so the
// output flips light/dark/Legacy through the cascade for free, exactly like the
// rest of the system. Fully unit-tested (the grep-score deliverable).
//
// Colour-alone is never meaning here (WCAG 1.4.1): these helpers only PAINT.
// Anywhere a category colour encodes which drink family a surface belongs to,
// the caller pairs it with the DrinkGlyph or a text label — the colour is
// decoration layered on a cue that already reads without it.

import type { DrinkCategory } from "@/lib/drinks";
import { categoryColor } from "@/lib/categoryColors";

/**
 * The canonical ordered rotation of drink categories for decorative cycling
 * (e.g. the landing "golden days" cards, a row of accents). Ordered for visual
 * rhythm — warm brass/amber, into the cool teal/ice, through the reds/violet,
 * ending on the neutral bark — NOT the taxonomy order in lib/drinks.ts. This is
 * a colour cadence, so it's deliberately its own sequence.
 *
 * `beer` is intentionally first: it's the brass base hue, so a rotation that
 * starts on it keeps brass as the through-line even while cycling colour.
 */
export const CATEGORY_ROTATION: readonly DrinkCategory[] = [
  "beer",
  "gin",
  "wine",
  "vodka",
  "rum",
  "cocktail",
  "whisky",
  "shot",
] as const;

/**
 * The i-th category in {@link CATEGORY_ROTATION}, wrapping so any index (incl.
 * negative) is valid. Use for "give card N a category accent" cycling.
 */
export function rotateCategory(index: number): DrinkCategory {
  const n = CATEGORY_ROTATION.length;
  // `((i % n) + n) % n` gives a non-negative modulo for negative indices too.
  const i = ((Math.trunc(index) % n) + n) % n;
  return CATEGORY_ROTATION[i];
}

/**
 * The landing "wedge" — three value cards (price / setting / story) — mapped to
 * a category whose hue fits the card's meaning:
 *   · price   → beer   (the pint, the brass base accent — costs are brass)
 *   · setting → gin    (botanical teal — gardens, by-the-water, the room)
 *   · story   → rum    (mahogany — old wood, coaching inns, history)
 * These are decorative tints; each card still carries its own icon + heading,
 * so the colour never stands alone as the cue (WCAG 1.4.1).
 */
export const WEDGE_CATEGORY = {
  price: "beer",
  setting: "gin",
  story: "rum",
} as const satisfies Record<string, DrinkCategory>;

export type WedgeKey = keyof typeof WEDGE_CATEGORY;

/** Resolve a wedge slot key to its category. */
export function wedgeCategory(key: WedgeKey): DrinkCategory {
  return WEDGE_CATEGORY[key];
}

/** True if `key` is a known wedge slot (narrowing guard for untyped callers). */
export function isWedgeKey(key: string): key is WedgeKey {
  return key in WEDGE_CATEGORY;
}

/**
 * A SUBTLE two-stop linear-gradient string tinting `base` toward the category's
 * colour — for a card/panel/header wash, NOT a loud hero gradient. The category
 * hue is mixed into the base at a low percentage at the start stop and fades to
 * the plain base by the end, so the surface reads as "warmed by" the colour
 * rather than painted in it.
 *
 * Everything is a token reference (`var(--cat-*)`, and `base` should be a token
 * like `var(--panel)`), so the gradient flips light/dark/Legacy for free.
 *
 * @param category  drink category whose `--cat-*` token tints the surface
 * @param base      the surface's own background token (default `var(--panel)`)
 * @param opts.angle  gradient angle in deg (default 160 — matches goldenCard)
 * @param opts.strength  category mix % at the start stop (default 9, clamped 0–100)
 * @param opts.fade   position (%) where the tint has faded fully to base (default 68)
 */
export function categoryGradient(
  category: DrinkCategory,
  base = "var(--panel)",
  opts: { angle?: number; strength?: number; fade?: number } = {},
): string {
  const angle = Number.isFinite(opts.angle) ? (opts.angle as number) : 160;
  const strength = clampPct(opts.strength ?? 9);
  const fade = clampPct(opts.fade ?? 68);
  const cat = categoryColor(category);
  const start = `color-mix(in srgb, ${cat} ${strength}%, ${base})`;
  return `linear-gradient(${angle}deg, ${start} 0%, ${base} ${fade}%)`;
}

/**
 * A single flat `color-mix()` tint of a category colour into a base — for a
 * chip fill, an icon well, a hairline. Token-only, so theme-aware.
 *
 * @param strength  category mix % (default 12, clamped 0–100)
 * @param base      base token to mix into (default `transparent`)
 */
export function categoryTint(
  category: DrinkCategory,
  strength = 12,
  base = "transparent",
): string {
  return `color-mix(in srgb, ${categoryColor(category)} ${clampPct(
    strength,
  )}%, ${base})`;
}

/** Clamp a number into the valid CSS percentage range [0, 100]. */
function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}
