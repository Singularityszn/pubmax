import Link from "next/link";
import type { LiHTMLAttributes, ReactElement } from "react";

// CategoryShowcase — the flagship of the E5 colour system. Two modes off one
// component:
//   · legend mode (default) — a compact swatch grid demonstrating the whole
//     drink palette at a glance (a menu header / footer flourish);
//   · explore mode (`hrefFor` provided) — a REAL "Explore by drink" grid of
//     tappable category cards (colour + glyph + label), each a deep-link into a
//     filtered view.
// When `onCategoryActivate` is also provided (Discover brand chips), cards
// select the category first so brand chips can appear; the category-only map
// link lives in the parent brand panel.
// Consumes only OWNED assets: DrinkGlyph (our IP SVGs) + the `--cat-*` tokens,
// on a `.textured-panel` paper/linen surface. Correct in light, dark AND Legacy
// Mode with no per-theme code — everything flips via the cascade. The glyph +
// label always accompany the colour (never colour alone, WCAG 1.4.1).
import { DRINK_CATEGORIES, CATEGORY_META } from "@/lib/drinks";
import type { DrinkCategory } from "@/lib/drinks";
import { DrinkGlyph } from "./DrinkGlyph";
import "./categoryShowcase.css";

export type CategoryShowcaseExtraItem = ReactElement<LiHTMLAttributes<HTMLLIElement>, "li">;

export interface CategoryShowcaseProps {
  /** Optional heading; omit to render just the swatch grid. */
  title?: string;
  /** Glyph pixel size. Defaults to 28 (legend) / 34 (explore). */
  glyphSize?: number;
  className?: string;
  /**
   * When provided, each category renders as a tappable card linking to this
   * href — turning the legend into a real "Explore by drink" grid. Omit for the
   * static legend. Ignored for navigation when `onCategoryActivate` is set
   * (parent shows brand chips + the category-only map link).
   */
  hrefFor?: (category: DrinkCategory) => string;
  /** Optional sub-label under each category (explore mode), e.g. "Find a pub". */
  cardHint?: string;
  /** Optional extra <li> cards rendered in the same grid, e.g. Low/No alcohol. */
  extraItems?: CategoryShowcaseExtraItem | CategoryShowcaseExtraItem[];
  /** Whether extra cards appear before or after the canonical drink categories. */
  extraItemsPosition?: "start" | "end";
  /** When set, category cards select first (brand-chip flow) instead of navigating. */
  onCategoryActivate?: (category: DrinkCategory) => void;
  /** Currently selected category for the brand-chip flow. */
  activeCategory?: DrinkCategory | null;
}

export function CategoryShowcase({
  title = "Every drink, every colour",
  glyphSize,
  className,
  hrefFor,
  cardHint,
  extraItems,
  extraItemsPosition = "end",
  onCategoryActivate,
  activeCategory = null,
}: CategoryShowcaseProps) {
  const explore = Boolean(hrefFor) || Boolean(onCategoryActivate);
  const size = glyphSize ?? (explore ? 34 : 28);

  return (
    <section
      className={`catShowcase textured-panel${explore ? " catShowcase--explore" : ""}${
        className ? ` ${className}` : ""
      }`}
      aria-label={explore ? "Explore drinks by category" : "Drink category colours"}
    >
      {title ? <h3 className="catShowcase__title">{title}</h3> : null}
      <ul className="catShowcase__grid">
        {extraItemsPosition === "start" ? extraItems : null}
        {DRINK_CATEGORIES.map((category) => {
          const label = CATEGORY_META[category].label;
          const isActive = activeCategory === category;
          const inner = (
            <>
              <span
                className="catShowcase__swatch"
                style={{ color: `var(--cat-${category})` }}
              >
                <DrinkGlyph category={category} size={size} inheritColor />
              </span>
              <span className="catShowcase__labelWrap">
                <span className="catShowcase__label">{label}</span>
                {explore && cardHint ? (
                  <span className="catShowcase__hint">{cardHint}</span>
                ) : null}
              </span>
            </>
          );

          return (
            <li
              key={category}
              className={`catShowcase__item${isActive ? " catShowcase__item--active" : ""}`}
              // The category token drives the card's tint/border in explore mode
              // (CSS reads --cat via currentColor on the swatch; here we also
              // expose it to the card frame).
              style={
                explore
                  ? ({ ["--cat" as string]: `var(--cat-${category})` } as React.CSSProperties)
                  : undefined
              }
            >
              {onCategoryActivate ? (
                <button
                  type="button"
                  className="catShowcase__link"
                  aria-label={`Choose ${label}`}
                  aria-pressed={isActive}
                  onClick={() => onCategoryActivate(category)}
                >
                  {inner}
                </button>
              ) : explore && hrefFor ? (
                <Link
                  className="catShowcase__link"
                  href={hrefFor(category)}
                  aria-label={`Explore ${label}`}
                >
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
        {extraItemsPosition === "end" ? extraItems : null}
      </ul>
    </section>
  );
}
