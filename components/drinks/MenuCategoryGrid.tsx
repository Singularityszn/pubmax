import { ExternalLink, UtensilsCrossed } from "lucide-react";
import type { CSSProperties } from "react";

import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import type { MenuHubTile } from "@/lib/menuHub";
import type { DrinkCategory } from "@/lib/drinks";
import { isPubVenueKind, venueKindNoun } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";

import "./menuCategoryGrid.css";

export type MenuCategoryGridProps = {
  tiles: MenuHubTile[];
  onOpenDrinks: (category?: DrinkCategory) => void;
  onAddDrink?: () => void;
  venueKind?: VenueKind;
  foodCount?: number;
  onOpenFood?: () => void;
};

export default function MenuCategoryGrid({
  tiles,
  onOpenDrinks,
  onAddDrink,
  venueKind,
  foodCount = 0,
  onOpenFood,
}: MenuCategoryGridProps) {
  const hasFood = foodCount > 0 && Boolean(onOpenFood);
  const venueNoun = venueKindNoun(venueKind);
  const hasDrinkTiles = tiles.some((tile) => tile.kind !== "food-external");
  const unavailableDrinks = (
    <div className="menuHubEmpty">
      <p className="menuHubEmptyTitle" role="status">
        We don&rsquo;t have this {venueNoun}&rsquo;s drinks yet.
      </p>
      {onAddDrink ? (
        <button type="button" className="menuHubEmptyAction" onClick={onAddDrink}>
          Add what you’re drinking
        </button>
      ) : null}
    </div>
  );

  if (tiles.length === 0 && !hasFood) {
    return unavailableDrinks;
  }

  return (
    <>
      {isPubVenueKind(venueKind) && !hasDrinkTiles ? unavailableDrinks : null}
      <section className="menuHub" aria-label="Menus">
        <header className="menuHub__head">
          <h3 className="menuHub__title">Menus</h3>
          <p className="menuHub__lede">
            {hasFood ? hasDrinkTiles ? "Choose food or drinks to see the prices we have." : "Open Food to see the dish prices we have." :
              hasDrinkTiles ? "Choose a drink to see the prices we have." :
                "Open the menu or website for what’s on offer."}
          </p>
        </header>
        <ul className={`menuHub__grid${hasFood ? " menuHub__grid--with-food" : ""}${hasFood && !hasDrinkTiles ? " menuHub__grid--food-only" : ""}`}>
          {hasFood ? (
            <li className="menuHub__item menuHub__item--recorded-food">
              <button type="button" className="menuHub__tile" data-menu-door="food" onClick={onOpenFood}>
                <span className="menuHub__media menuHub__media--food" aria-hidden="true">
                  <UtensilsCrossed size={30} />
                </span>
                <span className="menuHub__meta">
                  <span className="menuHub__label">Food</span>
                  <span className="menuHub__hint">{foodCount} {foodCount === 1 ? "dish" : "dishes"} on record</span>
                </span>
              </button>
            </li>
          ) : null}
          {tiles.map((tile) => {
            if (tile.kind === "food-external" && !tile.href) {
              return null;
            }

            if (tile.kind === "food-external" && tile.href) {
              return (
                <li key={tile.id} className="menuHub__item menuHub__item--food">
                  <a
                    className="menuHub__tile pressable"
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
                  data-menu-door={category ?? "all"}
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
    </>
  );
}
