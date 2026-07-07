import { CATEGORY_ACCENT } from "@/lib/categoryColors";
import { formatPrice } from "@/lib/venues";
import {
  groupDrinksByCategory,
  type Drink,
  type DrinkCategory,
  type DrinkProvenance,
} from "@/lib/drinks";

import "./drinkMenu.css";

// The venue Menu (PRD E1): a venue's drinks grouped by category, each section
// carrying its own colour token (lib/categoryColors.ts — E5 owns the canonical
// palette) and a per-drink row: name, producer/style/abv, a brass price stamp
// (reusing the shared .ink-stamp idiom), and a provenance chip so a seeded demo
// pour is always visibly distinct from a real price.
//
// Server-composable: it takes `drinks` as a prop (the caller runs
// venueDrinkMenu(venueId, venue.prices) — no client fetch), so it drops into a
// server OR client component. Purely presentational. When a venue has nothing
// beyond its pint rows, an honest EmptyState renders instead of a bare frame.

// Honest source labels for the provenance chip. A seeded demo menu reads
// "Demo"; a first-party dataset price reads "On record"; anything else shows
// its raw source so a new permissible source (Wikidata, a chain site) is never
// silently relabelled.
function provenanceLabel(prov: DrinkProvenance): string {
  if (prov.source === "seed") return "Demo";
  if (prov.source === "app-dataset") return "On record";
  return prov.source;
}

function ProvChip({ prov }: { prov: DrinkProvenance }) {
  const label = provenanceLabel(prov);
  const kind = prov.source === "seed" ? "demo" : "sourced";
  return (
    <span
      className={`drinkProvChip ${kind}`}
      title={`${label} · ${prov.licence}`}
    >
      {label}
    </span>
  );
}

// The one-line descriptor under a drink name: producer, style, abv, region —
// only the parts that exist (never a fabricated blank). Serving size trails.
function drinkMeta(drink: Drink): string {
  const parts: string[] = [];
  if (drink.producer) parts.push(drink.producer);
  if (drink.style) parts.push(drink.style);
  if (drink.region) parts.push(drink.region);
  if (typeof drink.abv === "number") parts.push(`${drink.abv}%`);
  return parts.join(" · ");
}

function DrinkRow({ drink }: { drink: Drink }) {
  const meta = drinkMeta(drink);
  return (
    <li className="drinkRow">
      <div className="drinkRowMain">
        <span className="drinkName">{drink.name}</span>
        {meta ? <span className="drinkMeta">{meta}</span> : null}
        {drink.servingSize ? (
          <span className="drinkServing">{drink.servingSize}</span>
        ) : null}
      </div>
      <div className="drinkRowSide">
        <span className="drinkPrice ink-stamp">{formatPrice(drink.priceGbp)}</span>
        <ProvChip prov={drink.provenance} />
      </div>
    </li>
  );
}

function CategorySection({
  category,
  label,
  drinks,
}: {
  category: DrinkCategory;
  label: string;
  drinks: Drink[];
}) {
  const accent = CATEGORY_ACCENT[category];
  return (
    <section
      className="drinkCategory"
      // The category accent is applied as a CSS custom property so drinkMenu.css
      // owns HOW it's used (rule, dot, tint) — E5 can later swap the value for a
      // token without the component changing.
      style={{ ["--cat-accent" as string]: accent }}
      aria-labelledby={`drink-cat-${category}`}
    >
      <h4 className="drinkCategoryTitle" id={`drink-cat-${category}`}>
        <span className="drinkCategoryDot" aria-hidden="true" />
        {label}
      </h4>
      <ul className="drinkList">
        {drinks.map((drink) => (
          <DrinkRow key={drink.id} drink={drink} />
        ))}
      </ul>
    </section>
  );
}

export type DrinkMenuProps = {
  drinks: Drink[];
  /** Venue name, for the honest empty-state copy. */
  venueName?: string;
};

export default function DrinkMenu({ drinks, venueName }: DrinkMenuProps) {
  const groups = groupDrinksByCategory(drinks);

  if (groups.length === 0) {
    return (
      <div className="drinkMenu drinkMenuEmpty" role="status">
        <p className="drinkMenuEmptyTitle">No menu on record yet</p>
        <p className="drinkMenuEmptyBody">
          {venueName ? `${venueName} hasn't` : "This pub hasn't"} logged any
          drinks beyond the pint list. Prices you see are community-updated —
          not a live feed.
        </p>
      </div>
    );
  }

  return (
    <div className="drinkMenu">
      {groups.map((group) => (
        <CategorySection
          key={group.category}
          category={group.category}
          label={group.label}
          drinks={group.drinks}
        />
      ))}
      <p className="drinkMenuFootnote">
        Every drink carries its source · Demo items are seeded examples, never a
        live price.
      </p>
    </div>
  );
}
