import {
  CATEGORY_META,
  groupDrinksByCategory,
  type Drink,
  type DrinkCategory,
} from "@/lib/drinks";
import type { Venue } from "@/lib/venues";
import { venueExternalActions } from "@/lib/venueExternalActions";

/**
 * Menu tab hub tiles — alcohol-first visual grid inspired by chain Menus UIs.
 * Drinks are always primary; food is an external link tile when we have a URL
 * (never an invented in-app food menu).
 */

export type MenuHubTileKind = "drinks" | "drink-category" | "food-external";

export type MenuHubTile = {
  id: string;
  kind: MenuHubTileKind;
  label: string;
  hint?: string;
  /** Present for drink-category tiles. */
  category?: DrinkCategory;
  /** External http(s) link for food / full menu. */
  href?: string;
  count?: number;
};

export function menuHubTiles(venue: Venue, drinks: Drink[]): MenuHubTile[] {
  const tiles: MenuHubTile[] = [];
  const groups = groupDrinksByCategory(drinks);
  const totalDrinks = drinks.length;

  if (totalDrinks > 0) {
    tiles.push({
      id: "drinks",
      kind: "drinks",
      label: "Drinks",
      hint: totalDrinks === 1 ? "1 on record" : `${totalDrinks} on record`,
      count: totalDrinks,
    });
  }

  // Category tiles only when more than one family is present — otherwise the
  // Drinks tile alone is enough and we avoid a one-tile echo of Beer.
  if (groups.length > 1) {
    for (const group of groups) {
      tiles.push({
        id: `cat-${group.category}`,
        kind: "drink-category",
        label: CATEGORY_META[group.category].label,
        category: group.category,
        hint: group.drinks.length === 1 ? "1 pour" : `${group.drinks.length} pours`,
        count: group.drinks.length,
      });
    }
  }

  const external = venueExternalActions(venue);
  const menuOrSite = external.find((a) => a.kind === "menu" || a.kind === "website");
  if (menuOrSite && venue.amenities.food) {
    tiles.push({
      id: "food-external",
      kind: "food-external",
      label: "Food menu",
      hint: "Opens the pub site",
      href: menuOrSite.href,
    });
  }

  return tiles;
}
