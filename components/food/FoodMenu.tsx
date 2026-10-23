import { formatPrice } from "@/lib/venues";
import { firstHttp } from "@/lib/httpUrl";
import { formatObservedDate, SNAPSHOT_CAPTION_PREFIX } from "@/lib/dataFreshness";
import PriceBadge from "@/components/PriceBadge";
import {
  foodCategoryColor,
  groupFoodByCategory,
  type FoodCategory,
  type FoodItem,
  type FoodProvenance,
} from "@/lib/food";

import "@/components/drinks/drinkMenu.css";

function provenanceLabel(prov: FoodProvenance): string {
  if (prov.source === "seed" || prov.source.toLowerCase().includes("demo")) return "Demo";
  return prov.source;
}

function isDemoProvenance(prov: FoodProvenance): boolean {
  return prov.source === "seed" || prov.source.toLowerCase().includes("demo");
}

function isUsableDietaryEvidence(prov: FoodItem["dietaryProvenance"], observed: Date | null): boolean {
  return Boolean(prov && prov.source.trim() && prov.licence.trim() &&
    !isDemoProvenance(prov) && firstHttp(prov.sourceUrl) &&
    observed && Number.isFinite(observed.getTime()));
}

function ProvChip({ prov, source }: { prov: FoodProvenance; source?: string }) {
  const label = provenanceLabel(prov);
  const kind = isDemoProvenance(prov) ? "demo" : "sourced";
  const sourceUrl = firstHttp(source);
  const className = `drinkProvChip ${kind}`;
  const title = `${prov.source} · ${prov.licence}`;
  return sourceUrl && kind !== "demo" ? (
    <a className={className} title={title} href={sourceUrl} target="_blank" rel="noopener noreferrer">{label}</a>
  ) : (
    <span className={className} title={title}>
      {label}{source && kind !== "demo" ? " · Link unavailable" : ""}
    </span>
  );
}

function FoodRow({ item }: { item: FoodItem }) {
  const observed = new Date(item.provenance.observedAt);
  const hasDate = !isDemoProvenance(item.provenance) && Number.isFinite(observed.getTime());
  const calorieProv = item.caloriesProvenance;
  const calorieDate = calorieProv ? new Date(calorieProv.observedAt) : null;
  const hasCalories = typeof item.caloriesKcal === "number" &&
    Number.isFinite(item.caloriesKcal) && item.caloriesKcal >= 0 &&
    calorieProv && !isDemoProvenance(calorieProv) &&
    calorieDate && Number.isFinite(calorieDate.getTime());
  const calorieSource = firstHttp(calorieProv?.sourceUrl);
  const sharedObservation = hasCalories && calorieProv && calorieSource &&
    calorieSource === firstHttp(item.source) &&
    calorieProv.source === item.provenance.source &&
    calorieProv.licence === item.provenance.licence &&
    calorieProv.observedAt === item.provenance.observedAt;
  const dietaryProv = item.dietaryProvenance;
  const dietaryDate = dietaryProv ? new Date(dietaryProv.observedAt) : null;
  const hasDietaryEvidence = isUsableDietaryEvidence(dietaryProv, dietaryDate);
  const dietary =
    hasDietaryEvidence && item.dietary && item.dietary.length > 0
      ? item.dietary.map((d) => d.replace("-", " ")).join(" · ")
      : "";
  return (
    <li className="drinkRow">
      <div className="drinkRowMain">
        <span className="drinkName">{item.name}</span>
        {item.description ? <span className="drinkMeta">{item.description}</span> : null}
        {dietary && dietaryProv && dietaryDate ? (
          <div className="drinkServing">
            <span>{dietary}</span>{" "}
            <ProvChip prov={dietaryProv} source={dietaryProv.sourceUrl} />{" "}
            <span className="drinkObservationAge">
              {SNAPSHOT_CAPTION_PREFIX}{" "}
              <time dateTime={dietaryProv.observedAt}>{formatObservedDate(dietaryDate)}</time>
            </span>
          </div>
        ) : null}
        {hasCalories && calorieProv && calorieDate ? (
          <div className="foodCalories drinkMeta">
            <span>{item.caloriesKcal} kcal on the menu</span>{" "}
            {!sharedObservation ? <>
              <ProvChip prov={calorieProv} source={calorieProv.sourceUrl} />
              <span className="drinkObservationAge">
                {SNAPSHOT_CAPTION_PREFIX}{" "}
                <time dateTime={calorieProv.observedAt}>{formatObservedDate(calorieDate)}</time>
              </span>
            </> : null}
          </div>
        ) : null}
      </div>
      <div className="drinkRowSide">
        <PriceBadge variant="neutral" className="drinkPrice">
          {formatPrice(item.priceGbp)}
        </PriceBadge>
        {sharedObservation ? <span className="drinkMeta">Price and calories</span> : null}
        <ProvChip prov={item.provenance} source={item.source} />
        {hasDate ? (
          <span className="drinkObservationAge">
            {SNAPSHOT_CAPTION_PREFIX}{" "}
            <time dateTime={item.provenance.observedAt}>{formatObservedDate(observed)}</time>
          </span>
        ) : null}
      </div>
    </li>
  );
}

function CategorySection({
  category,
  label,
  items,
}: {
  category: FoodCategory;
  label: string;
  items: FoodItem[];
}) {
  const accent = foodCategoryColor(category);
  return (
    <section
      className="drinkCategory"
      style={{ ["--cat-accent" as string]: accent }}
      aria-labelledby={`food-cat-${category}`}
    >
      <h4 className="drinkCategoryTitle" id={`food-cat-${category}`}>
        <span className="drinkCategoryDot" aria-hidden="true" />
        {label}
      </h4>
      <ul className="drinkList">
        {items.map((item) => (
          <FoodRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

export type FoodMenuProps = {
  items: FoodItem[];
  venueName?: string;
  onBack?: () => void;
};

export default function FoodMenu({ items, venueName, onBack }: FoodMenuProps) {
  const groups = groupFoodByCategory(items);

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="drinkMenu foodMenu" aria-label={venueName ? `Food at ${venueName}` : "Food menu"}>
      {onBack ? (
        <button type="button" className="drinkMenuBack" aria-label="Back to menus" onClick={onBack}>
          ← Menus
        </button>
      ) : null}
      <h3 className="drinkCategoryTitle" style={{ marginBottom: 4 }}>
        Food
      </h3>
      {groups.map((group) => (
        <CategorySection
          key={group.category}
          category={group.category}
          label={group.label}
          items={group.items}
        />
      ))}
      <p className="drinkMenuFootnote">
        Menu prices show their source and collection date when recorded. Published menus can change.
      </p>
    </div>
  );
}
