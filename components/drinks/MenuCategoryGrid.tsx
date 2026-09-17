import { ExternalLink, UtensilsCrossed } from "lucide-react";
import type { CSSProperties } from "react";

import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import type { MenuHubTile } from "@/lib/menuHub";
import type { DrinkCategory } from "@/lib/drinks";
import { isPubVenueKind, venueKindNoun } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";

import styles from "./menuCategoryGrid.module.css";

export type MenuCategoryGridProps = {
  tiles: MenuHubTile[];
  onOpenDrinks: (category?: DrinkCategory) => void;
  onAddDrink?: () => void;
  venueKind?: VenueKind;
};

export default function MenuCategoryGrid({
  tiles,
  onOpenDrinks,
  onAddDrink,
  venueKind,
}: MenuCategoryGridProps) {
  const venueNoun = venueKindNoun(venueKind);
  const hasDrinkTiles = tiles.some((tile) => tile.kind !== "food-external");
  const unavailableDrinks = (
    <div className={styles.menuHubEmpty}>
      <p className={styles.menuHubEmptyTitle} role="status">
        We don&rsquo;t have this {venueNoun}&rsquo;s drinks yet.
      </p>
      {onAddDrink ? (
        <button type="button" className={styles.menuHubEmptyAction} onClick={onAddDrink}>
          Add what you’re drinking
        </button>
      ) : null}
    </div>
  );

  if (tiles.length === 0) {
    return unavailableDrinks;
  }

  return (
    <>
      {isPubVenueKind(venueKind) && !hasDrinkTiles ? unavailableDrinks : null}
      <section className={styles.menuHub} aria-label="Menus">
        <header className={styles.menuHubHead}>
          <h3 className={styles.menuHubTitle}>Menus</h3>
          <p className={styles.menuHubLede}>
            {hasDrinkTiles ? (
              <>
                Drinks first. Tap a tile. Food opens the {venueNoun}&apos;s own menu
                when we have a link.
              </>
            ) : (
              <>Food opens the {venueNoun}&rsquo;s own menu.</>
            )}
          </p>
        </header>
        <ul className={styles.menuHubGrid}>
          {tiles.map((tile) => {
            if (tile.kind === "food-external" && !tile.href) {
              return null;
            }

            if (tile.kind === "food-external" && tile.href) {
              return (
                <li key={tile.id} className={`${styles.menuHubItem} ${styles.menuHubItemFood}`}>
                  <a
                    className={`${styles.menuHubTile} pressable`}
                    href={tile.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span
                      className={`${styles.menuHubMedia} ${styles.menuHubMediaFood}${tile.imageUrl ? ` ${styles.menuHubMediaPhoto}` : ""}`}
                      aria-hidden="true"
                    >
                      {tile.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- curated external menu tile photos
                        <img
                          className={styles.menuHubPhoto}
                          src={tile.imageUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <UtensilsCrossed size={28} />
                      )}
                    </span>
                    <span className={styles.menuHubMeta}>
                      <span className={styles.menuHubLabel}>{tile.label}</span>
                      {tile.hint ? <span className={styles.menuHubHint}>{tile.hint}</span> : null}
                    </span>
                    <ExternalLink size={13} className={styles.menuHubExt} aria-hidden="true" />
                  </a>
                </li>
              );
            }

            const category = tile.kind === "drink-category" ? tile.category : undefined;
            const isPrimary = tile.kind === "drinks";
            return (
              <li
                key={tile.id}
                className={`${styles.menuHubItem}${isPrimary ? ` ${styles.menuHubItemPrimary}` : ""}`}
              >
                <button
                  type="button"
                  className={styles.menuHubTile}
                  onClick={() => onOpenDrinks(category)}
                  style={
                    category
                      ? ({ ["--hub-cat" as string]: `var(--cat-${category})` } as CSSProperties)
                      : undefined
                  }
                >
                  <span
                    className={`${styles.menuHubMedia}${isPrimary ? ` ${styles.menuHubMediaDrinks}` : ""}`}
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
                  <span className={styles.menuHubMeta}>
                    <span className={styles.menuHubLabel}>{tile.label}</span>
                    {tile.hint ? <span className={styles.menuHubHint}>{tile.hint}</span> : null}
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
