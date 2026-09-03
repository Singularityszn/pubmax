import { drinkCategoryFromText } from "@/lib/drinkCategoryFromText";
import type { Drink } from "@/lib/drinks";
import type { PintDrop } from "@/lib/pintDropShared";

// Public venue menus may use the already-loaded Pint Drop read, but they must
// keep its public visibility boundary. The API applies this filter as well;
// keeping the pure menu seam defensive prevents a private row from appearing
// if a caller hands it an unfiltered list.
function isPublicVisibleDrop(drop: PintDrop): boolean {
  if (drop.status !== "visible") return false;
  const visibility = drop.visibility ?? "public";
  return visibility === "public" || visibility === "anonymous";
}

function normaliseDrinkName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

function menuRowKey(name: string, priceGbp: number): string {
  return `${normaliseDrinkName(name)}\u0000${priceGbp.toFixed(2)}`;
}

/**
 * Turn public priced Pint Drops into menu rows without creating a new read
 * path. The returned rows are additions only: callers pass the existing
 * curated menu so a matching name and price stays one row.
 *
 * Pint Drop drink text remains free text at the API boundary. The existing
 * conservative parser owns category assignment; an unknown label is omitted
 * instead of being guessed as beer or "other". Prices and provenance stay
 * attached to the observation, and demo drops retain a visible demo marker.
 */
export function pintDropDrinksForMenu(
  drops: readonly PintDrop[],
  curatedDrinks: readonly Drink[] = [],
): Drink[] {
  const seen = new Set(
    curatedDrinks
      .filter(
        (drink) =>
          typeof drink.name === "string" &&
          drink.name.trim() !== "" &&
          typeof drink.priceGbp === "number" &&
          Number.isFinite(drink.priceGbp),
      )
      .map((drink) => menuRowKey(drink.name, drink.priceGbp)),
  );
  const additions: Drink[] = [];

  for (const drop of drops) {
    if (!isPublicVisibleDrop(drop)) continue;
    if (typeof drop.id !== "string" || drop.id.trim() === "") continue;
    if (typeof drop.drink !== "string" || drop.drink.trim() === "") continue;
    if (
      typeof drop.priceGbp !== "number" ||
      !Number.isFinite(drop.priceGbp) ||
      drop.priceGbp <= 0
    ) {
      continue;
    }

    const name = drop.drink.trim().replace(/\s+/g, " ");
    const category = drinkCategoryFromText(name);
    if (!category) continue;

    const key = menuRowKey(name, drop.priceGbp);
    if (seen.has(key)) continue;
    seen.add(key);

    const demo = drop.provenance === "demo";
    additions.push({
      id: `pint-drop-${drop.id}`,
      category,
      name,
      priceGbp: drop.priceGbp,
      provenance: {
        source: demo ? "Pint Drop demo" : "Pint Drop",
        licence: demo ? "demo" : "community contribution",
        observedAt: drop.createdAt,
      },
    });
  }

  return additions;
}
