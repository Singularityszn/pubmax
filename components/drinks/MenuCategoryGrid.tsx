import { ExternalLink, UtensilsCrossed } from "lucide-react";
import type { CSSProperties } from "react";

import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import type { MenuHubTile } from "@/lib/menuHub";
import type { DrinkCategory } from "@/lib/drinks";

import "./menuCategoryGrid.css";

export type MenuCategoryGridProps = {
  tiles: MenuHubTile[];
  onOpenDrinks: (category?: DrinkCategory) => void;
  venueName?: string;
};

/**
 * Greene King–inspired Menus hub: 2-column visual tiles.
 * Drinks first; food is an external link when we have a URL.
 */
export default function MenuCategoryGrid({
  tiles,
  onOpenDrinks,
  venueName,
}: MenuCategoryGridProps) {
  if (tiles.length === 0) {
    return (
      <div className="menuHubEmpty" role="status">
        <p className="menuHubEmptyTitle">No menu on record yet</p>
        <p className="menuHubEmptyBody">
          {venueName ? `${venueName} hasn't` : "This pub hasn't"} logged drinks
          beyond the map price, and there&apos;s no external menu link yet.
        </p>
      </div>
    );
  }

  return (
    <section className="menuHub" aria-label="Menus">
      <header className="menuHub__head">
        <h3 className="menuHub__title">Menus</h3>
        <p className="menuHub__lede">
          Drinks first — tap a tile. Food opens the pub&apos;s own menu when we
          have a link.
        </p>
      </header>
      <ul className="menuHub__grid">
        {tiles.map((tile) => {
          if (tile.kind === "food-external" && !tile.href) {
            return null;
          }

          if (tile.kind === "food-external" && tile.href) {
            return (
              <li key={tile.id} className="menuHub__item menuHub__item--food">
                <a
                  className="menuHub__tile"
                  href={tile.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span
                    className={`menuHub__media menuHub__media--food${tile.imageUrl ? " menuHub__media--photo" : ""}`}
                    aria-hidden="true"
                  >
                    {tile.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- curated external menu tile photos
                      <img
                        className="menuHub__photo"
                        src={tile.imageUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <UtensilsCrossed size={28} />
                    )}
                  </span>
                  <span className="menuHub__meta">
                    <span className="menuHub__label">{tile.label}</span>
                    {tile.hint ? <span className="menuHub__hint">{tile.hint}</span> : null}
                  </span>
                  <ExternalLink size={13} className="menuHub__ext" aria-hidden="true" />
                </a>
              </li>
            );
          }

          const category = tile.kind === "drink-category" ? tile.category : undefined;
          const isPrimary = tile.kind === "drinks";
          return (
            <li
              key={tile.id}
              className={`menuHub__item${isPrimary ? " menuHub__item--primary" : ""}`}
            >
              <button
                type="button"
                className="menuHub__tile"
                onClick={() => onOpenDrinks(category)}
                style={
                  category
                    ? ({ ["--hub-cat" as string]: `var(--cat-${category})` } as CSSProperties)
                    : undefined
                }
              >
                <span
                  className={`menuHub__media${isPrimary ? " menuHub__media--drinks" : ""}`}
                  style={
                    !category && isPrimary
                      ? ({ color: "var(--cat-beer)" } as CSSProperties)
                      : category
                        ? ({ color: `var(--cat-${category})` } as CSSProperties)
                        : undefined
                  }
                  aria-hidden="true"
                >
                  <DrinkGlyph category={category ?? "beer"} size={isPrimary ? 36 : 30} inheritColor />
                </span>
                <span className="menuHub__meta">
                  <span className="menuHub__label">{tile.label}</span>
                  {tile.hint ? <span className="menuHub__hint">{tile.hint}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
