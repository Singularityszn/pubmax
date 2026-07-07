// CategoryShowcase — a compact legend demonstrating the E5 category colour
// system + drink glyphs. Drop it on a future menu header / discover surface to
// show the whole drink palette at a glance. Consumes only OWNED assets:
// DrinkGlyph (our IP SVGs) + the `--cat-*` tokens, on a `.textured-panel`
// paper/linen surface. Renders correctly in light, dark AND Legacy Mode with
// no per-theme code — everything flips via the cascade.
import { DRINK_CATEGORIES, CATEGORY_META } from "@/lib/drinks";
import { DrinkGlyph } from "./DrinkGlyph";
import "./categoryShowcase.css";

export interface CategoryShowcaseProps {
  /** Optional heading; omit to render just the swatch grid. */
  title?: string;
  /** Glyph pixel size. Defaults to 28. */
  glyphSize?: number;
  className?: string;
}

export function CategoryShowcase({
  title = "Every drink, every colour",
  glyphSize = 28,
  className,
}: CategoryShowcaseProps) {
  return (
    <section
      className={`catShowcase textured-panel${className ? ` ${className}` : ""}`}
      aria-label="Drink category colours"
    >
      {title ? <h3 className="catShowcase__title">{title}</h3> : null}
      <ul className="catShowcase__grid">
        {DRINK_CATEGORIES.map((category) => (
          <li key={category} className="catShowcase__item">
            <span
              className="catShowcase__swatch"
              style={{ color: `var(--cat-${category})` }}
            >
              <DrinkGlyph category={category} size={glyphSize} inheritColor />
            </span>
            <span className="catShowcase__label">
              {CATEGORY_META[category].label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
